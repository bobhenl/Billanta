import type { Metadata } from 'next';
import { getLocale, getTranslations } from 'next-intl/server';
import { Banner } from '@/components/banner';
import { settingsGate } from '@/components/settings-gate';
import { redirect } from '@/i18n/navigation';
import { apiFetch, ApiError, NoTenantError, NotSignedInError } from '@/lib/api-client';
import { fetchUsage } from '@/lib/tenant';
import { PlanLock } from '@/components/plan-lock';
import { lockOf } from '@/lib/usage';
import { SealedTaxReturn } from './sealed-tax-return';
import { RATES, TaxReturnDownloads, TaxReturnView, type TaxReturnData, type Translate } from './tax-return-view';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('taxReturn');
  return { title: t('metaTitle') };
}

/** Until June the return for last year is the live one; from July this year's running figures. */
function defaultYear(now: Date): number {
  return now.getMonth() < 6 ? now.getFullYear() - 1 : now.getFullYear();
}

/**
 * "Podklady pro daňové přiznání": the tax year's own figures laid out for
 * the income tax return, on every plan. The numbers come from the backend
 * (the company's paid invoices and expenses), the rates and limits from
 * @faktur/cz-compliance for that exact year. A basis, not tax advice.
 */
export default async function TaxReturnPage({ searchParams }: { searchParams: Promise<{ year?: string; rate?: string }> }) {
  const gate = await settingsGate('exports');
  if (gate) return gate;
  const t = await getTranslations('taxReturn');
  const tCat = await getTranslations('expenses.category');
  const locale = await getLocale();
  const sp = await searchParams;
  const now = new Date();
  const thisYear = now.getFullYear();
  const years = [thisYear, thisYear - 1, thisYear - 2, thisYear - 3];
  const asked = Number(sp.year);
  const year = years.includes(asked) ? asked : defaultYear(now);
  const rate = (RATES as readonly string[]).includes(sp.rate ?? '') ? (sp.rate as (typeof RATES)[number]) : '60';
  const query = `year=${year}&rate=${rate}`;

  let r: TaxReturnData;
  const usageLoad = fetchUsage();
  try {
    r = await apiFetch<TaxReturnData>(`/api/v1/exports/tax-return-basis?${query}`);
  } catch (error) {
    if (error instanceof NotSignedInError) redirect({ href: '/login', locale });
    // Sealed amounts (Důvěrný režim): this browser opens them and computes the same figures.
    if (error instanceof ApiError && error.status === 409 && error.body.includes('amounts_sealed')) {
      const lock = lockOf(await usageLoad, 'income_tax_export');
      return <SealedTaxReturn year={year} rate={rate} years={years} thisYear={thisYear} lock={lock} />;
    }
    return (
      <Banner tone={error instanceof NoTenantError ? 'info' : 'err'} className="mt-6">
        {t(error instanceof NoTenantError ? 'noTenant' : error instanceof ApiError && error.status === 503 ? 'ratesUnavailable' : 'loadError')}
      </Banner>
    );
  }

  // The figures stay on screen on every plan; only the files are Start and up.
  const downloadLock = lockOf(await usageLoad, 'income_tax_export');
  return (
    <TaxReturnView
      r={r}
      t={t as unknown as Translate}
      tCat={tCat as unknown as Translate}
      locale={locale}
      year={year}
      rate={rate}
      years={years}
      thisYear={thisYear}
      downloads={downloadLock ? <PlanLock plan={downloadLock} /> : <TaxReturnDownloads t={t as unknown as Translate} query={query} />}
    />
  );
}
