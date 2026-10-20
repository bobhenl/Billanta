import type { Metadata } from 'next';
import { getLocale, getTranslations } from 'next-intl/server';
import { redirect } from '@/i18n/navigation';
import { Banner } from '@/components/banner';
import { SettingsHeader } from '@/components/settings-header';
import { NotSignedInError } from '@/lib/api-client';
import { canManage, fetchMyAccess, type MyAccess } from '@/lib/tenant';
import { TOGGLEABLE_MODULES, type ModuleSet } from '@/lib/business-presets';
import { ModulesSettings } from './modules-settings';
import { settingsGate } from '@/components/settings-gate';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('settings.modules');
  return { title: t('title') };
}

/** Settings → Modules: pick a business-type preset or switch individual parts of the app off. */
export default async function ModulesPage() {
  const gate = await settingsGate('modules');
  if (gate) return gate;
  const locale = await getLocale();
  const t = await getTranslations('settings.modules');

  let access: MyAccess;
  try {
    access = await fetchMyAccess();
  } catch (error) {
    if (error instanceof NotSignedInError) redirect({ href: '/login', locale });
    return <Banner tone="err" title={t('loadError')} className="mt-6" />;
  }
  const modules = Object.fromEntries(TOGGLEABLE_MODULES.map((m) => [m, access.modules[m]])) as ModuleSet;

  return (
    <div className="mx-auto max-w-3xl">
      <SettingsHeader title={t('title')} description={t('description')} />
      {!canManage(access.role) && (
        <Banner tone="info" className="mt-4">
          {t('readOnly')}
        </Banner>
      )}
      <ModulesSettings initial={modules} readOnly={!canManage(access.role)} />
    </div>
  );
}
