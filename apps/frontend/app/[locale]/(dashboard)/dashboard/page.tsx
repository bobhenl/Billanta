import type { Metadata } from 'next';
import { getLocale, getTranslations } from 'next-intl/server';
import { Banner } from '@/components/banner';
import { redirect } from '@/i18n/navigation';
import { apiFetch, NoTenantError, NotSignedInError } from '@/lib/api-client';
import { auth } from '@/auth';
import { fetchMyAccess, fetchTenant, hiddenSections, vatStatusOf, type TaxAdvances } from '@/lib/tenant';
import { isLegalEntityName, type TaxProfile } from '@/lib/tax-deadlines';
import { normalizeTaxAdvances } from '@faktur/cz-compliance';
import type { TimeSummary } from '@/lib/time-ui';
import type { Usage } from '@/lib/usage-defaults';
import { DashboardView } from './dashboard-view';
import { presetRange } from '@/lib/period-presets';
import type { DashboardConfig, DashboardSummary, PeriodStats } from './types';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('dashboard');
  return { title: t('title') };
}

export default async function DashboardHomePage() {
  const t = await getTranslations('dashboard');
  const locale = await getLocale();
  let summary: DashboardSummary;
  let config: DashboardConfig | null;
  let profile: TaxProfile | undefined;
  let advances: TaxAdvances = [];
  let country = 'CZ';
  let time: TimeSummary | null = null;
  let stats: PeriodStats | null = null;
  let usage: Usage | null = null;
  try {
    let tenant;
    const { from, to } = presetRange('last12');
    // All in one round: the time summary waits only for the access check
    // that decides whether to load it, not for the slower summary/stats.
    const access = fetchMyAccess().catch(() => null);
    [summary, config, tenant, usage, stats, time] = await Promise.all([
      apiFetch<DashboardSummary>('/api/v1/dashboard/summary'),
      apiFetch<DashboardConfig>('/api/v1/dashboard/config').catch(() => null),
      fetchTenant().catch(() => null),
      apiFetch<Usage>('/api/v1/dashboard/usage').catch(() => null),
      apiFetch<PeriodStats>(`/api/v1/dashboard/stats?from=${from}&to=${to}`).catch(() => null),
      access.then((a) => (hiddenSections(a).includes('time') ? null : apiFetch<TimeSummary>('/api/v1/time-entries/summary').catch(() => null)))
    ]);
    country = tenant?.addressCountry ?? 'CZ';
    profile = { country, vatStatus: vatStatusOf(tenant), legalEntity: isLegalEntityName(tenant?.legalName), flatTax: tenant?.flatTaxRegime ?? null };
    advances = normalizeTaxAdvances(tenant?.taxAdvances);
  } catch (error) {
    if (error instanceof NotSignedInError) redirect({ href: '/login', locale });
    if (error instanceof NoTenantError) {
      return (
        <Banner tone="info" className="mt-6">
          {t('noTenant')}
        </Banner>
      );
    }
    return (
      <Banner tone="err" className="mt-6">
        {t('loadError')}
      </Banner>
    );
  }
  const session = await auth().catch(() => null);
  const firstName = session?.user?.name?.trim().split(/\s+/)[0] ?? null;

  return <DashboardView summary={summary} initialConfig={config} firstName={firstName} profile={profile} advances={advances} country={country} time={time} stats={stats} usage={usage} />;
}
