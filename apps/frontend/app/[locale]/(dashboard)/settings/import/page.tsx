import type { Metadata } from 'next';
import { getLocale, getTranslations } from 'next-intl/server';
import { redirect } from '@/i18n/navigation';
import { Banner } from '@/components/banner';
import { SettingsHeader } from '@/components/settings-header';
import { NotSignedInError } from '@/lib/api-client';
import { canManage, fetchMyRole } from '@/lib/tenant';
import { isSource } from './import-sources';
import { MigrationWizard } from './migration-wizard';
import { settingsGate } from '@/components/settings-gate';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('settings.import');
  return { title: t('title') };
}

/**
 * Settings → Přechod z jiného systému: contacts + invoice history from a CSV
 * or .xlsx export. `?source=<app>` (from /switch and the welcome screen)
 * opens that app's export steps.
 */
export default async function ImportSettingsPage({ searchParams }: { searchParams: Promise<{ source?: string | string[] }> }) {
  const { source } = await searchParams;
  const gate = await settingsGate('import');
  if (gate) return gate;
  const locale = await getLocale();
  const t = await getTranslations('settings.import');
  let role: string | null;
  try {
    role = await fetchMyRole();
  } catch (error) {
    if (error instanceof NotSignedInError) redirect({ href: '/login', locale });
    role = null;
  }

  return (
    <div className="mx-auto max-w-3xl">
      <SettingsHeader title={t('title')} description={t('description')} />
      {!canManage(role) && (
        <Banner tone="info" className="mt-4">
          {t('readOnly')}
        </Banner>
      )}
      <MigrationWizard readOnly={!canManage(role)} initialSource={isSource(source) ? source : undefined} />
    </div>
  );
}
