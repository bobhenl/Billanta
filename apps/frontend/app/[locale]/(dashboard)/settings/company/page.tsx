import type { Metadata } from 'next';
import { getLocale, getTranslations } from 'next-intl/server';
import { redirect } from '@/i18n/navigation';
import { Banner } from '@/components/banner';
import { SettingsHeader } from '@/components/settings-header';
import { NotSignedInError } from '@/lib/api-client';
import { type BankAccount, canManage, fetchBankAccounts, fetchMyRole, fetchTenant, type TenantSettings } from '@/lib/tenant';
import { CompanyForm } from './company-form';
import { settingsGate } from '@/components/settings-gate';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('settings.company');
  return { title: t('title') };
}

export default async function CompanyPage() {
  const gate = await settingsGate('company');
  if (gate) return gate;
  const locale = await getLocale();
  const t = await getTranslations('settings.company');

  let tenant: TenantSettings | null;
  let role: string | null;
  let accounts: BankAccount[];
  try {
    [tenant, role, accounts] = await Promise.all([fetchTenant(), fetchMyRole(), fetchBankAccounts()]);
  } catch (error) {
    if (error instanceof NotSignedInError) redirect({ href: '/login', locale });
    return <Banner tone="err" title={t('loadError')} className="mt-6" />;
  }
  if (!tenant) return <Banner tone="err" title={t('loadError')} className="mt-6" />;

  return (
    <div className="mx-auto max-w-3xl">
      <SettingsHeader title={t('title')} description={t('description')} />
      {!canManage(role) && (
        <Banner tone="info" className="mt-4">
          {t('readOnly')}
        </Banner>
      )}
      <CompanyForm tenant={tenant} accounts={accounts} readOnly={!canManage(role)} />
    </div>
  );
}
