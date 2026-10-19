import type { Metadata } from 'next';
import { getFormatter, getLocale, getTranslations } from 'next-intl/server';
import { Calculator } from 'lucide-react';
import { Link, redirect } from '@/i18n/navigation';
import { Banner } from '@/components/banner';
import { EmbedSection } from '@/components/embed-section';
import { SettingsHeader } from '@/components/settings-header';
import { QrLinkPanel } from '@/components/share-qr';
import { apiFetch, NotSignedInError } from '@/lib/api-client';
import { SITE_URL } from '@/lib/site';
import { canManage, fetchMyRole } from '@/lib/tenant';
import { ReferralsPanel, type ReferralOverview } from './referrals-panel';
import { settingsGate } from '@/components/settings-gate';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('referrals');
  return { title: t('title') };
}

/** Settings → Invite for credits: the invite link, credit balance, what credits buy and who signed up. */
export default async function ReferralsPage() {
  const gate = await settingsGate('referrals');
  if (gate) return gate;
  const locale = await getLocale();
  const t = await getTranslations('referrals');
  const format = await getFormatter();

  let overview: ReferralOverview;
  let role: string | null;
  try {
    [overview, role] = await Promise.all([apiFetch<ReferralOverview>('/api/v1/referrals'), fetchMyRole()]);
  } catch (error) {
    if (error instanceof NotSignedInError) redirect({ href: '/login', locale });
    return <Banner tone="err" title={t('loadError')} className="mt-6" />;
  }

  const link = `${SITE_URL}/${locale}/signup?ref=${overview.code}`;

  return (
    <div className="mx-auto max-w-3xl">
      <SettingsHeader title={t('title')} description={t('description')} />
      <ReferralsPanel overview={overview} link={link} readOnly={!canManage(role)} />
      <section className="mt-6 rounded-xl border border-border bg-card p-4">
        <h2 className="font-bold">{t('qr.title')}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t('qr.hint')}</p>
        <QrLinkPanel url={link} fileSlug={`ref-${overview.code.toLowerCase()}`} className="mx-auto max-w-sm" />
      </section>
      <EmbedSection
        section="settings"
        tabs={['badge', 'qr', 'pay', 'vat']}
        badgeKinds={overview.program === 'accountant' || overview.canBeAccountant ? ['customer', 'partner'] : ['customer']}
        refCode={overview.code}
        className="mt-6 sm:p-4"
      />
      <p className="mt-6 rounded-xl border border-border bg-card p-4 text-sm">
        <Calculator className="mr-1.5 inline h-4 w-4 align-[-2px] text-primary" aria-hidden="true" />
        {t('profileLink.body')}{' '}
        <Link href="/settings/accountant-profile" className="font-semibold text-primary hover:underline">
          {t('profileLink.cta')}
        </Link>
      </p>

      <section className="mt-6 rounded-xl border border-border bg-card p-4">
        <h2 className="font-bold">{t('invited.title')}</h2>
        {overview.invited.length === 0 ? (
          <p className="mt-1 text-sm text-muted-foreground">{t('invited.empty')}</p>
        ) : (
          <ul className="mt-3 divide-y divide-border text-sm">
            {overview.invited.map((r, i) => (
              <li key={i} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>
                  {t('invited.company', { n: overview.invited.length - i })}
                  <span className="ml-2 text-xs text-muted-foreground">{format.dateTime(new Date(r.createdAt), { dateStyle: 'medium' })}</span>
                </span>
                <span className={r.state === 'rewarded' ? 'font-semibold text-primary' : 'text-muted-foreground'}>
                  {r.state === 'rewarded'
                    ? t('invited.paying', { credits: r.rewardCredits ?? 0 })
                    : r.state === 'pending'
                      ? r.releaseAfter
                        ? t('invited.heldUntil', {
                            credits: r.pendingCredits ?? 0,
                            date: format.dateTime(new Date(r.releaseAfter), { dateStyle: 'medium' })
                          })
                        : t('invited.heldMonthly', { credits: r.pendingCredits ?? 0 })
                      : r.state === 'voided'
                        ? t('invited.voided')
                        : t('invited.waiting')}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-6 rounded-xl border border-border bg-card p-4">
        <h2 className="font-bold">{t('ledger.title')}</h2>
        {overview.ledger.length === 0 ? (
          <p className="mt-1 text-sm text-muted-foreground">{t('ledger.empty')}</p>
        ) : (
          <ul className="mt-3 divide-y divide-border text-sm">
            {overview.ledger.map((row) => (
              <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>
                  {t(`ledger.reason.${row.reason}`, { plan: row.plan ? t(`plans.${row.plan}`) : '', months: row.months ?? 0 })}
                  <span className="ml-2 text-xs text-muted-foreground">{format.dateTime(new Date(row.createdAt), { dateStyle: 'medium' })}</span>
                </span>
                <span className={row.amount > 0 ? 'font-semibold text-primary' : 'text-muted-foreground'}>
                  {row.amount > 0 ? '+' : '−'}
                  {t('credits', { credits: Math.abs(row.amount) })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
