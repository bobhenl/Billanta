import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';

// TODO: tenant settings (company details, bank account, default locale,
// members/roles per blueprint §4 `tenant_memberships`) once the backend
// and auth session exist. Stubbed for now so the nav link resolves. The
// "Channels" sub-page (blueprint §6 account linking), "API keys" sub-page
// (public API, apps/backend/src/api-keys/), and "Backup destinations"
// sub-page (per-tenant Google Drive/webhook export,
// apps/backend/src/backup-destinations/ — NOT the platform-wide
// apps/backup pg_dump sidecar) are built out already — see ./channels,
// ./api-keys, and ./backup — everything else here is still a placeholder.
export default async function SettingsPage() {
  const t = await getTranslations('settings');
  const tCommon = await getTranslations('common');

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
      <p className="mt-2 text-muted-foreground">{t('comingSoon')}</p>
      <div className="mt-6 rounded-lg border border-dashed border-border p-8 text-sm text-muted-foreground">
        {tCommon('comingSoonBody')}
      </div>

      <div className="mt-4 flex flex-col items-start gap-2">
        <Link
          href="/settings/channels"
          className="inline-flex items-center text-sm font-medium text-primary underline underline-offset-2 hover:no-underline"
        >
          {t('channels.title')} →
        </Link>

        <Link
          href="/settings/api-keys"
          className="inline-flex items-center text-sm font-medium text-primary underline underline-offset-2 hover:no-underline"
        >
          {t('apiKeys.title')} →
        </Link>

        <Link
          href="/settings/backup"
          className="inline-flex items-center text-sm font-medium text-primary underline underline-offset-2 hover:no-underline"
        >
          {t('backup.title')} →
        </Link>
      </div>
    </div>
  );
}
