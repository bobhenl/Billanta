import type { Metadata } from 'next';
import { getLocale, getTranslations } from 'next-intl/server';
import { redirect } from '@/i18n/navigation';
import { Banner } from '@/components/banner';
import { SettingsHeader } from '@/components/settings-header';
import { NotSignedInError } from '@/lib/api-client';
import { canManage, fetchMyRole, fetchTenant, type TenantSettings } from '@/lib/tenant';
import { VariablesEditor } from './variables-editor';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('settings.variables');
  return { title: t('title') };
}

/** Settings → Proměnné: the company's own `{placeholders}` plus a reference of the built-in ones. */
export default async function VariablesPage() {
  const locale = await getLocale();
  const t = await getTranslations('settings.variables');

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
    <div className="mx-auto max-w-4xl">
      <SettingsHeader title={t('title')} description={t('description')} />
      {!canManage(role) && (
        <Banner tone="info" className="mt-4">
          {t('readOnly')}
        </Banner>
      )}
      <VariablesEditor
        initial={tenant.templateVars ?? []}
        company={{ companyName: tenant.companyName, ico: tenant.ico, dic: tenant.dic, email: tenant.email }}
        readOnly={!canManage(role)}
      />
    </div>
  );
}
