import type { Metadata } from 'next';
import { getFormatter, getLocale, getTranslations } from 'next-intl/server';
import { CZ_TAX_YEAR_LIST, OSVC_PARAM_YEARS, type SealedIncomeDoc, type YearIncomeInputs } from '@faktur/cz-compliance';
import { Banner } from '@/components/banner';
import { InfoHint } from '@/components/info-hint';
import { FlatTaxCalculator, type FlatTaxPrefill } from '@/components/public-tools/flat-tax-calculator';
import { ToolDisclaimer } from '@/components/public-tools/parts';
import { Link, redirect } from '@/i18n/navigation';
import { apiFetch, NoTenantError, NotSignedInError } from '@/lib/api-client';
import { isLegalEntityName } from '@/lib/tax-deadlines';
import { fetchTenant, taxCountryOf, vatStatusOf, type TenantSettings } from '@/lib/tenant';
import { SealedFlatTax } from './sealed-prefill';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('tools.calculators.items.flatTax.app');
  return { title: t('title') };
}

/** The part of `GET /exports/annual-summary` this page reads. */
interface AnnualSums {
  year: number;
  income: number;
  actualExpenses: number;
  /** Documents with sealed amounts, left out of `income`. */
  sealed?: { count: number };
  counts?: YearIncomeInputs['counts'];
  /** The plain documents' income before rounding, and the sealed ones for this browser to open (Důvěrný režim). */
  plainIncome?: number;
  sealedDocs?: SealedIncomeDoc[];
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

  // An income short of the sealed documents would tilt the comparison: with any of them this browser opens
  // them first (SealedFlatTax), and the server's sum never prefills.
  const sealedCount = sums?.sealed?.count ?? 0;
  const vatPayer = vatStatusOf(tenant) === 'payer';
  const prefill: FlatTaxPrefill | undefined = sums && sealedCount === 0
    ? { year: sums.year, income: sums.income, actualExpenses: sums.actualExpenses, vatPayer }
    : undefined;
  const sealedInputs: YearIncomeInputs | null =
    sums && sealedCount > 0 && sums.sealedDocs?.length && sums.plainIncome != null && sums.counts
      ? { vatPayer, plainIncome: sums.plainIncome, counts: sums.counts, sealedDocs: sums.sealedDocs }
      : null;
  const czk = (n: number) => format.number(Math.round(n), { style: 'currency', currency: 'CZK', maximumFractionDigits: 0 });
  // The paušální režim exists only for Czech sole traders.
  const notOsvc = tenant != null && (taxCountryOf(tenant) === 'SK' || isLegalEntityName(tenant.legalName));
  const before = notOsvc ? <Banner tone="info">{t('notOsvc')}</Banner> : null;
  const after = (
    <>
      {tenant?.flatTaxRegime != null && <p className="text-sm text-muted-foreground">{t(tenant.flatTaxRegime ? 'regimeFlat' : 'regimeRegular')}</p>}
      {tenant?.activityKind === 'secondary' && <p className="text-sm text-muted-foreground">{t('secondary')}</p>}
    </>
  );

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <InfoHint hint={t('lead')} className="min-w-0">
          <h1 className="text-2xl font-extrabold tracking-tight">{t('title')}</h1>
        </InfoHint>
        <Link href="/calculators/flat-tax" className="text-sm font-semibold text-primary hover:underline">
          {t('publicLink')}
        </Link>
      </div>
      {sealedInputs && sums ? (
        <SealedFlatTax years={years} year={sums.year} actualExpenses={sums.actualExpenses} inputs={sealedInputs} before={before} after={after} />
      ) : (
        <>
          <div className="mb-6 space-y-2">
            {before}
            {sealedCount > 0 ? (
              <Banner tone="info">{t('sealed', { count: sealedCount })}</Banner>
            ) : prefill ? (
              <Banner tone="info">{t('prefilled', { year: prefill.year, income: czk(prefill.income), expenses: czk(prefill.actualExpenses) })}</Banner>
            ) : (
              <Banner tone="warn">{t('loadError')}</Banner>
            )}
            {after}
          </div>
          <FlatTaxCalculator years={years} prefill={prefill} />
        </>
      )}
      <div className="mt-6">
        <ToolDisclaimer validity={years.length ? tc('validFor', { year: years.join(', ') }) : undefined} />
      </div>
    </div>
  );
}
