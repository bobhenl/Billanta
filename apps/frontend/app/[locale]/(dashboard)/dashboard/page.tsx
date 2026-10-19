import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { getLocale, getTranslations } from 'next-intl/server';
import { Banner } from '@/components/banner';
import { redirect } from '@/i18n/navigation';
import { apiFetch, NoTenantError, NotSignedInError } from '@/lib/api-client';
import { auth } from '@/auth';
import { canManage, fetchMyAccess, fetchTenant, forbiddenSettings, hiddenSections, vatStatusOf, type MyAccess, type TaxAdvances } from '@/lib/tenant';
import { isLegalEntityName, type TaxProfile } from '@/lib/tax-deadlines';
import { normalizeTaxAdvances } from '@faktur/cz-compliance';
import type { TimeSummary } from '@/lib/time-ui';
import type { Usage } from '@/lib/usage-defaults';
import { REFERRAL_REWARDS } from '@/lib/referral';
import { SITE_URL } from '@/lib/site';
import { DashboardView } from './dashboard-view';
import { SwitchBanner } from '@/components/switch-banner';
import { isSwitchBrand, SWITCH_COOKIE } from '@/lib/switch';
import { presetRange } from '@/lib/period-presets';
import { FULL_ABILITIES, type DashboardAbilities, type DashboardConfig, type DashboardSummary, type PeriodStats } from './types';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('dashboard');
  return { title: t('title') };
}

/** No access info (older backend): everything shows and the backend still decides. */
function abilitiesOf(access: MyAccess | null): DashboardAbilities {
  if (!access) return FULL_ABILITIES;
  const p = access.permissions;
  const forbidden = forbiddenSettings(access);
  return {
    role: access.role,
    hidden: hiddenSections(access),
    createInvoices: p.invoices === 'write',
    createExpenses: p.expenses === 'write' && access.modules.expenses,
    createContacts: p.contacts === 'write',
    manage: canManage(access.role),
    exports: access.modules.reports && !forbidden.has('exports'),
    integrations: !forbidden.has('integrations')
  };
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
  let referral: { code: string; link: string; welcome: number; reward: number } | null = null;
  let abilities = FULL_ABILITIES;
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
    abilities = abilitiesOf(await access);
    country = tenant?.addressCountry ?? 'CZ';
    profile = { country, vatStatus: vatStatusOf(tenant), legalEntity: isLegalEntityName(tenant?.legalName), flatTax: tenant?.flatTaxRegime ?? null };
    advances = normalizeTaxAdvances(tenant?.taxAdvances);
    // Only after money has actually come in (last 12 months is close enough to "ever").
    // Inviting others is the company's call (Settings → Doporučení is for owners and admins).
    if (abilities.manage && (stats?.current.paidCount ?? 0) > 0) {
      const overview = await apiFetch<{ code: string; program: keyof typeof REFERRAL_REWARDS; stats: { invited: number } }>('/api/v1/referrals').catch(() => null);
      if (overview && overview.stats.invited === 0) {
        const rewards = REFERRAL_REWARDS[overview.program] ?? REFERRAL_REWARDS.friend;
        referral = { code: overview.code, link: `${SITE_URL}/${locale}/signup?ref=${overview.code}`, ...rewards };
      }
    }
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

  // Nothing issued yet: offer the import of the history from the previous app.
  const from = (await cookies()).get(SWITCH_COOKIE)?.value;
  const switchBanner = abilities.manage && summary.recent.length === 0 ? <SwitchBanner source={isSwitchBrand(from) ? from : null} /> : null;

  return (
    <>
      {switchBanner}
      <DashboardView summary={summary} initialConfig={config} firstName={firstName} profile={profile} advances={advances} country={country} time={time} stats={stats} usage={usage} referral={referral} abilities={abilities} />
    </>
  );
}
