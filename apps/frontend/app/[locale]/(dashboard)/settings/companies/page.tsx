import type { Metadata } from 'next';
import { getLocale, getTranslations } from 'next-intl/server';
import { redirect } from '@/i18n/navigation';
import { Banner } from '@/components/banner';
import { SettingsHeader } from '@/components/settings-header';
import { NotSignedInError, fetchMyCompanies, type CurrentTenant } from '@/lib/api-client';
import { CompaniesManager } from './companies-manager';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('settings.companies');
  return { title: t('title') };
}

/** Settings → Firmy: every company of the account, switch between them, add another one. */
export default async function CompaniesPage() {
  const locale = await getLocale();
  const t = await getTranslations('settings.companies');

  let data: { tenants: CurrentTenant[]; active: CurrentTenant };
  try {
    data = await fetchMyCompanies();
  } catch (error) {
    if (error instanceof NotSignedInError) redirect({ href: '/login', locale });
    return <Banner tone="err" title={t('loadError')} className="mt-6" />;
  }

  return (
    <div className="mx-auto max-w-3xl">
      <SettingsHeader title={t('title')} description={t('description')} />
      <CompaniesManager companies={data.tenants} activeId={data.active.id} />
    </div>
  );
}
