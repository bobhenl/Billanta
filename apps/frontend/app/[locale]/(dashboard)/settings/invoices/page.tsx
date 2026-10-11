import type { Metadata } from 'next';
import { getLocale, getTranslations } from 'next-intl/server';
import { redirect } from '@/i18n/navigation';
import { Banner } from '@/components/banner';
import { SettingsHeader } from '@/components/settings-header';
import { NotSignedInError } from '@/lib/api-client';
import { canManage, fetchMyRole, fetchTenant, type TenantSettings } from '@/lib/tenant';
import { formPrefs } from '../../invoices/new/load';
import { InvoiceFormSettings } from './invoice-form-settings';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('settings.invoices');
  return { title: t('title') };
}

/** Settings → Invoices: tailor the invoice form to what this company actually fills in. */
export default async function InvoiceSettingsPage() {
  const locale = await getLocale();
  const t = await getTranslations('settings.invoices');

  let tenant: TenantSettings | null;
  let role: string | null;
  try {
    [tenant, role] = await Promise.all([fetchTenant(), fetchMyRole()]);
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
      <InvoiceFormSettings prefs={formPrefs(tenant.invoiceFormPrefs)} vatPayer={tenant.dicVatPayer} readOnly={!canManage(role)} />
    </div>
  );
}
