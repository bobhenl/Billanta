import type { Metadata } from 'next';
import { getLocale, getTranslations } from 'next-intl/server';
import { redirect } from '@/i18n/navigation';
import { Banner } from '@/components/banner';
import { SettingsHeader } from '@/components/settings-header';
import { settingsGate } from '@/components/settings-gate';
import { apiFetch, NotSignedInError } from '@/lib/api-client';
import { canManage, fetchMyRole } from '@/lib/tenant';
import { ListingForm, type OwnListing } from './listing-form';
import { PartnerRequest } from './partner-request';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('accountantDirectory.profile');
  return { title: t('title') };
}

/**
 * Settings → Profil účetního: the company's entry in the accountant directory
 * and its request for the accountant partner tier. Staff approve both in the
 * same queue (admin/accountants).
 */
export default async function AccountantProfilePage() {
  const gate = await settingsGate('accountantProfile');
  if (gate) return gate;
  const locale = await getLocale();
  const t = await getTranslations('accountantDirectory.profile');

  let own: OwnListing;
  let role: string | null;
  try {
    [own, role] = await Promise.all([apiFetch<OwnListing>('/api/v1/referrals/listing'), fetchMyRole()]);
  } catch (error) {
    if (error instanceof NotSignedInError) redirect({ href: '/login', locale });
    return <Banner tone="err" title={t('loadError')} className="mt-6" />;
  }
  const readOnly = !canManage(role);
  const hasListing = Boolean(own.listing && own.listing.status !== 'withdrawn');

  return (
    <div className="mx-auto max-w-3xl">
      <SettingsHeader title={t('title')} description={t('description')} />
      <ListingForm own={own} readOnly={readOnly} />
      <section className="mt-6 rounded-xl border border-border bg-card p-4">
        <h2 className="font-bold">{t('partnerTitle')}</h2>
        <PartnerRequest status={own.partnerStatus} note={own.partnerNote} hasListing={hasListing} readOnly={readOnly} className="mt-3" />
      </section>
    </div>
  );
}
