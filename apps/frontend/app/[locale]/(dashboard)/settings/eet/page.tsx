import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { apiFetch } from '@/lib/api-client';
import { canManage, fetchMyAccess } from '@/lib/tenant';
import { SettingsHeader } from '@/components/settings-header';
import { EetSettingsForm } from './eet-settings-form';
import type { EetRecord, EetSettings } from './types';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('settings.eet');
  return { title: t('title') };
}

// Members may look at the records (they follow the invoices they see); only owners and admins change the settings.
export default async function EetSettingsPage() {
  const t = await getTranslations('settings.eet');
  const [settings, records, access] = await Promise.all([
    apiFetch<EetSettings>('/api/v1/tenants/me/eet').catch(() => null),
    apiFetch<EetRecord[]>('/api/v1/tenants/me/eet/records').catch(() => [] as EetRecord[]),
    fetchMyAccess().catch(() => null)
  ]);

  return (
    <div className="mx-auto max-w-3xl">
      <SettingsHeader title={t('title')} description={t('lead')} />
      <div className="mt-6">
        {settings ? (
          <EetSettingsForm initial={settings} records={records} canEdit={!access || canManage(access.role)} />
        ) : (
          <p className="text-sm text-destructive">{t('loadError')}</p>
        )}
      </div>
    </div>
  );
}
