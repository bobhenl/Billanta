import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import { redirect } from '@/i18n/navigation';
import { Banner } from '@/components/banner';
import { SettingsHeader } from '@/components/settings-header';
import { ApiError, apiFetch, NotSignedInError } from '@/lib/api-client';
import { PromoCodesAdmin, type AdminPromoCode } from './promo-codes-admin';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('adminPromoCodes');
  return { title: t('title'), robots: { index: false, follow: false } };
}

/**
 * Billanta staff only: promo codes for events, creators and schools. The
 * backend's PlatformAdminGuard decides who gets in; everyone else gets a
 * plain 404, so the page does not advertise itself.
 */
export default async function AdminPromoCodesPage() {
  const locale = await getLocale();
  const t = await getTranslations('adminPromoCodes');

  let codes: AdminPromoCode[];
  try {
    codes = await apiFetch<AdminPromoCode[]>('/api/v1/admin/promo-codes');
  } catch (error) {
    if (error instanceof NotSignedInError) redirect({ href: '/login', locale });
    if (error instanceof ApiError && (error.status === 401 || error.status === 403)) notFound();
    return <Banner tone="err" title={t('loadError')} className="mt-6" />;
  }

  return (
    <div className="mx-auto max-w-4xl">
      <SettingsHeader title={t('title')} description={t('description')} />
      <PromoCodesAdmin codes={codes} />
    </div>
  );
}
