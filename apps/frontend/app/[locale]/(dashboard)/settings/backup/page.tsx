import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import {
  BackupDestinationsManager,
  type BackupDestinationListItem
} from './backup-destinations-manager';

/**
 * PLACEHOLDER DATA — TODO: replace with a real fetch to
 * `GET /api/v1/backup-destinations` (`apps/backend/src/backup-destinations/`)
 * once an authenticated frontend API client exists, same caveat as
 * `settings/api-keys/page.tsx`'s `MOCK_API_KEYS` / `settings/channels
 * /page.tsx`'s `MOCK_CHANNEL_LINKS` — this whole dashboard has no real
 * fetch wiring yet (no Auth.js session -> backend-JWT bridge for client
 * components), so every settings sub-page follows the same "mock the data,
 * wire the real network call later" pattern. Shape mirrors
 * `BackupDestinationsService.list`'s response exactly (never the encrypted
 * config blob or a decrypted secret).
 */
const MOCK_DESTINATIONS: BackupDestinationListItem[] = [
  {
    id: 'dest-1',
    type: 'google_drive',
    schedule: 'weekly',
    isActive: true,
    webhookUrl: null,
    googleDriveFolderId: null,
    lastRunAt: '2026-09-07T03:00:00.000Z',
    lastRunStatus: 'success',
    createdAt: '2026-08-01T09:00:00.000Z'
  },
  {
    id: 'dest-2',
    type: 'webhook',
    schedule: 'daily',
    isActive: true,
    webhookUrl: 'https://example.com/faktur-webhook',
    googleDriveFolderId: null,
    lastRunAt: '2026-09-09T04:00:00.000Z',
    lastRunStatus: 'Webhook destination responded with HTTP 503',
    createdAt: '2026-08-15T12:00:00.000Z'
  },
  {
    id: 'dest-3',
    // No config fields at all — see `BackupDestinationsManager`'s doc
    // comment for `type: 'local'`: there is nothing to authenticate
    // against, the "destination" is just this tenant's own browser
    // download. `schedule` is always `'manual'` (server-enforced).
    type: 'local',
    schedule: 'manual',
    isActive: true,
    webhookUrl: null,
    googleDriveFolderId: null,
    lastRunAt: null,
    lastRunStatus: null,
    createdAt: '2026-09-09T10:00:00.000Z'
  }
];

interface BackupSettingsPageProps {
  searchParams: Promise<{ connected?: string; error?: string }>;
}

export default async function BackupSettingsPage({ searchParams }: BackupSettingsPageProps) {
  const t = await getTranslations('settings.backup');
  const params = await searchParams;

  return (
    <div>
      <Link href="/settings" className="text-sm text-muted-foreground hover:text-foreground">
        ← {t('back')}
      </Link>

      <h1 className="mt-2 text-2xl font-semibold tracking-tight">{t('title')}</h1>
      <p className="mt-1 text-muted-foreground">{t('description')}</p>

      {/*
        These two banners reflect REAL query params: the backend's Google
        Drive OAuth callback (GoogleDriveCallbackController) redirects here
        with `?connected=google_drive` on success or `?error=...` if the
        tenant declined consent / Google reported an error — see that
        controller's `frontendSettingsUrl` helper. Rendering them is real,
        working logic; only the destinations LIST below is still mocked.
      */}
      {params.connected === 'google_drive' && (
        <div className="mt-4 rounded-lg border border-success/40 bg-success/10 p-3 text-sm text-success">
          {t('connectGoogleDrive.connectedBanner')}
        </div>
      )}
      {params.error && (
        <div className="mt-4 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {t('connectGoogleDrive.errorBanner', { error: params.error })}
        </div>
      )}

      <BackupDestinationsManager initialDestinations={MOCK_DESTINATIONS} />

      <p className="mt-4 text-xs text-muted-foreground">{t('docsHint')}</p>
    </div>
  );
}
