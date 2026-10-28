import type { Metadata } from 'next';
import { getLocale, getTranslations } from 'next-intl/server';
import { Banner } from '@/components/banner';
import { Link, redirect } from '@/i18n/navigation';
import { apiFetch, NoTenantError, NotSignedInError } from '@/lib/api-client';
import { fetchHomeCurrency } from '@/lib/tenant';
import { PERIOD_PRESETS, presetRange, type PeriodPreset } from '@/lib/period-presets';
import { inAppCalculatorPath } from '@/lib/public-tools';
import { isLegalEntityName } from '@/lib/tax-deadlines';
import { fetchTenant, taxCountryOf, type TenantSettings } from '@/lib/tenant';
import { PeriodReport } from '../dashboard/period-report';
import type { Usage } from '@/lib/usage-defaults';
import type { DashboardConfig, PeriodStats } from '../dashboard/types';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('reports');
  return { title: t('pageTitle') };
}

/**
 * Reports: the dashboard's period card at full size (all KPIs, top
 * customers), opened on `?period=` (a preset) or this year by default.
 */
export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ period?: string }> }) {
  const t = await getTranslations('reports');
  const locale = await getLocale();
  const { period } = await searchParams;
  const preset: PeriodPreset = (PERIOD_PRESETS as readonly string[]).includes(period ?? '') ? (period as PeriodPreset) : 'thisYear';
  const { from, to } = presetRange(preset);
  let stats: PeriodStats;
  let usage: Usage | null;
  let config: DashboardConfig | null;
  let tenant: TenantSettings | null;
  try {
    [stats, usage, config, tenant] = await Promise.all([
      apiFetch<PeriodStats>(`/api/v1/dashboard/stats?from=${from}&to=${to}${preset === 'all' ? '&period=all' : ''}`),
      // Both optional: without them the report shows everything, as before.
      apiFetch<Usage>('/api/v1/dashboard/usage').catch(() => null),
      apiFetch<DashboardConfig>('/api/v1/dashboard/config').catch(() => null),
      fetchTenant().catch(() => null)
    ]);
  } catch (error) {
    if (error instanceof NotSignedInError) redirect({ href: '/login', locale });
    return (
      <Banner tone={error instanceof NoTenantError ? 'info' : 'err'} className="mt-6">
        {t(error instanceof NoTenantError ? 'noTenant' : 'loadError')}
      </Banner>
    );
  }

  const link =
    'inline-flex h-9 shrink-0 items-center whitespace-nowrap rounded-full border border-border bg-card px-3 text-sm font-semibold text-primary transition-colors hover:bg-accent';

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h1 className="text-2xl font-extrabold tracking-tight">{t('pageTitle')}</h1>
        {/* Related pages as one swipeable row on a phone, so they never wrap under each other. */}
        <nav className="-mx-4 flex w-[calc(100%+2rem)] gap-1.5 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:w-auto sm:flex-wrap sm:px-0">
          {/* The paušální režim is for Czech sole traders only. */}
          {tenant && taxCountryOf(tenant) !== 'SK' && !isLegalEntityName(tenant.legalName) && (
            <Link href={inAppCalculatorPath('flat-tax')!} className={link}>
              {t('flatTaxLink')}
            </Link>
          )}
          <Link href="/reports/tax-return" className={link}>
            {t('taxReturnLink')}
          </Link>
          <Link href="/settings/exports" className={link}>
            {t('exportsLink')}
          </Link>
        </nav>
      </div>
      <PeriodReport key={preset} initial={stats} initialPreset={preset} usage={usage} savedKpis={config?.reportKpis ?? null} home={await fetchHomeCurrency()} />
    </div>
  );
}
