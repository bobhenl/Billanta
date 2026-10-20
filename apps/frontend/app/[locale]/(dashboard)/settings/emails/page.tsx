import type { Metadata } from 'next';
import { getLocale, getTranslations } from 'next-intl/server';
import { redirect } from '@/i18n/navigation';
import { Banner } from '@/components/banner';
import { SettingsHeader } from '@/components/settings-header';
import { NotSignedInError } from '@/lib/api-client';
import { canManage, emailPrefsOf, fetchMyRole, fetchTenant, type TenantSettings } from '@/lib/tenant';
import { EmailSettings } from './email-settings';
import { settingsGate } from '@/components/settings-gate';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('settings.emails');
  return { title: t('title') };
}

/** Settings → E-maily: how the invoice and reminder emails to customers look and who they come from. */
export default async function EmailSettingsPage() {
  const gate = await settingsGate('emails');
  if (gate) return gate;
  const locale = await getLocale();
  const t = await getTranslations('settings.emails');

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
    <div className="mx-auto max-w-5xl">
      <SettingsHeader title={t('title')} description={t('description')} />
      {!canManage(role) && (
        <Banner tone="info" className="mt-4">
          {t('readOnly')}
        </Banner>
      )}
      <EmailSettings
        prefs={emailPrefsOf(tenant.emailPrefs)}
        companyName={tenant.companyName}
        companyEmail={tenant.email}
        customVars={tenant.templateVars ?? []}
        readOnly={!canManage(role)}
      />
    </div>
  );
}
