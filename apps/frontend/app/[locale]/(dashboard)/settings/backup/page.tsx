import type { Metadata } from 'next';
import { getLocale, getTranslations } from 'next-intl/server';
import { Link, redirect } from '@/i18n/navigation';
import { apiFetch, ApiError, NotSignedInError } from '@/lib/api-client';
import { Banner } from '@/components/banner';
import { TwoFactorNotice } from '@/components/two-factor-notice';
import { settingsGate } from '@/components/settings-gate';
import {
  BackupDestinationsManager,
  type BackupDestinationListItem
} from './backup-destinations-manager';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('settings.backup');
  return { title: t('title') };
}

interface BackupSettingsPageProps {
  searchParams: Promise<{ connected?: string; error?: string }>;
}

export default async function BackupSettingsPage({ searchParams }: BackupSettingsPageProps) {
  const gate = await settingsGate('backup');
  if (gate) return gate;
  const t = await getTranslations('settings.backup');
  const locale = await getLocale();
  const params = await searchParams;

  // Backup destinations are owner-only on the backend (OwnerOnlyGuard): a
  // 403 means "not the owner", anything else is a genuine load failure.
  let destinations: BackupDestinationListItem[] = [];
  let state: 'ok' | 'ownerOnly' | 'error' = 'ok';
  try {
    destinations = await apiFetch<BackupDestinationListItem[]>('/api/v1/backup-destinations');
  } catch (error) {
    if (error instanceof NotSignedInError) redirect({ href: '/login', locale });
    state = error instanceof ApiError && error.status === 403 ? 'ownerOnly' : 'error';
  }

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
        working logic.
      */}
      {params.connected === 'google_drive' && (
        <Banner tone="ok" className="mt-4">
          {t('connectGoogleDrive.connectedBanner')}
        </Banner>
      )}
      {params.error && (
        <Banner tone="err" className="mt-4">
          {params.error === 'google_drive_unavailable'
            ? t('connectGoogleDrive.unavailable')
            : params.error === 'two_factor_required'
            ? t('twoFactorRequired')
            : t('connectGoogleDrive.errorBanner', { error: params.error })}
        </Banner>
      )}
      {state === 'ownerOnly' && (
        <Banner tone="info" className="mt-4">
          {t('ownerOnly')}
        </Banner>
      )}
      {state === 'error' && <Banner tone="err" title={t('loadError')} className="mt-4" />}

      {state === 'ok' && <TwoFactorNotice className="mt-4" />}
      {state === 'ok' && <BackupDestinationsManager initialDestinations={destinations} />}

      <p className="mt-4 text-xs text-muted-foreground">{t('docsHint')}</p>
    </div>
  );
}
