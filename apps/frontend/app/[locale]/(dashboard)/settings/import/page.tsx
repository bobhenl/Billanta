import type { Metadata } from 'next';
import { getLocale, getTranslations } from 'next-intl/server';
import { redirect } from '@/i18n/navigation';
import { Banner } from '@/components/banner';
import { SettingsHeader } from '@/components/settings-header';
import { NotSignedInError } from '@/lib/api-client';
import { canManage, fetchMyRole } from '@/lib/tenant';
import { MigrationWizard } from './migration-wizard';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('settings.import');
  return { title: t('title') };
}

/** Settings → Přechod z jiného systému: contacts + invoice history from a CSV export. */
export default async function ImportSettingsPage() {
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
      <MigrationWizard readOnly={!canManage(role)} />
    </div>
  );
}
