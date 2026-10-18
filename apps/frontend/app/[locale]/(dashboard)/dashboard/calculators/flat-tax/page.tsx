import type { Metadata } from 'next';
import { getFormatter, getLocale, getTranslations } from 'next-intl/server';
import { CZ_TAX_YEAR_LIST, OSVC_PARAM_YEARS } from '@faktur/cz-compliance';
import { Banner } from '@/components/banner';
import { FlatTaxCalculator, type FlatTaxPrefill } from '@/components/public-tools/flat-tax-calculator';
import { ToolDisclaimer } from '@/components/public-tools/parts';
import { Link, redirect } from '@/i18n/navigation';
import { apiFetch, NoTenantError, NotSignedInError } from '@/lib/api-client';
import { isLegalEntityName } from '@/lib/tax-deadlines';
import { fetchTenant, vatStatusOf, type TenantSettings } from '@/lib/tenant';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('tools.calculators.items.flatTax.app');
  return { title: t('title') };
}

/** The part of `GET /exports/annual-summary` this page reads. */
interface AnnualSums {
  year: number;
  income: number;
  actualExpenses: number;
}

/**
 * "Vyplatí se paušální daň?" inside the app: the public calculator's
 * component, prefilled with this year's paid invoices and expenses (the same
 * cash-basis sums as the annual estimate in Settings → Exporty) and the VAT
 * status. The visitor can still change every number; nothing is saved.
 */
export default async function InAppFlatTaxPage() {
  const t = await getTranslations('tools.calculators.items.flatTax.app');
  const tc = await getTranslations('tools.common');
  const locale = await getLocale();
  const format = await getFormatter();
  // Only years with both the paušální daň bands and OSVČ parameters, as on the public page.
  const years = CZ_TAX_YEAR_LIST.filter((y) => OSVC_PARAM_YEARS.includes(y));
  const thisYear = Number(new Intl.DateTimeFormat('en', { timeZone: 'Europe/Prague', year: 'numeric' }).format(new Date()));
  const year = years.includes(thisYear) ? thisYear : years[years.length - 1]!;

  let tenant: TenantSettings | null = null;
  let sums: AnnualSums | null = null;
  try {
    [tenant, sums] = await Promise.all([
      fetchTenant(),
      // Without a rate the backend counts actual expenses; the calculator applies the paušál itself.
      apiFetch<AnnualSums>(`/api/v1/exports/annual-summary?year=${year}&expenses=actual`).catch(() => null)
    ]);
  } catch (error) {
    if (error instanceof NotSignedInError) redirect({ href: '/login', locale });
    if (error instanceof NoTenantError) {
      return (
        <Banner tone="info" className="mt-6">
          {t('noTenant')}
        </Banner>
      );
    }
  }

  const prefill: FlatTaxPrefill | undefined = sums
    ? { year: sums.year, income: sums.income, actualExpenses: sums.actualExpenses, vatPayer: vatStatusOf(tenant) === 'payer' }
    : undefined;
  const czk = (n: number) => format.number(Math.round(n), { style: 'currency', currency: 'CZK', maximumFractionDigits: 0 });
  // The paušální režim exists only for Czech sole traders.
  const notOsvc = tenant != null && (tenant.addressCountry.toUpperCase() === 'SK' || isLegalEntityName(tenant.legalName));

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">{t('title')}</h1>
          <p className="mt-1 text-muted-foreground">{t('lead')}</p>
        </div>
        <Link href="/calculators/flat-tax" className="text-sm font-semibold text-primary hover:underline">
          {t('publicLink')}
        </Link>
      </div>
      <div className="mb-6 space-y-2">
        {notOsvc && <Banner tone="info">{t('notOsvc')}</Banner>}
        {prefill ? (
          <Banner tone="info">{t('prefilled', { year: prefill.year, income: czk(prefill.income), expenses: czk(prefill.actualExpenses) })}</Banner>
        ) : (
          <Banner tone="warn">{t('loadError')}</Banner>
        )}
        {tenant?.flatTaxRegime != null && <p className="text-sm text-muted-foreground">{t(tenant.flatTaxRegime ? 'regimeFlat' : 'regimeRegular')}</p>}
        {tenant?.activityKind === 'secondary' && <p className="text-sm text-muted-foreground">{t('secondary')}</p>}
      </div>
      <FlatTaxCalculator years={years} prefill={prefill} />
      <div className="mt-6">
        <ToolDisclaimer validity={years.length ? tc('validFor', { year: years.join(', ') }) : undefined} />
      </div>
    </div>
  );
}
