import type { Metadata } from 'next';
import { getLocale, getTranslations } from 'next-intl/server';
import { redirect } from '@/i18n/navigation';
import { Banner } from '@/components/banner';
import { TwoFactorNotice } from '@/components/two-factor-notice';
import { SettingsHeader } from '@/components/settings-header';
import { apiFetch, NotSignedInError } from '@/lib/api-client';
import { canManage, fetchMyRole, fetchUsage } from '@/lib/tenant';
import { lockOf } from '@/lib/usage';
import { PlanLock } from '@/components/plan-lock';
import { ApiKeysManager, type ApiKeyListItem } from './api-keys-manager';
import { settingsGate } from '@/components/settings-gate';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('settings.apiKeys');
  return { title: t('title') };
}

/** Settings → API klíče: the tenant's own public-API keys. */
export default async function ApiKeysSettingsPage() {
  const gate = await settingsGate('apiKeys');
  if (gate) return gate;
  const locale = await getLocale();
  const t = await getTranslations('settings.apiKeys');
  const tPlan = await getTranslations('planLimits');
  const usageLoad = fetchUsage();

  let keys: ApiKeyListItem[];
  let role: string | null;
  try {
    [keys, role] = await Promise.all([apiFetch<ApiKeyListItem[]>('/api/v1/api-keys'), fetchMyRole()]);
  } catch (error) {
    if (error instanceof NotSignedInError) redirect({ href: '/login', locale });
    return <Banner tone="err" title={t('loadError')} className="mt-6" />;
  }

  // In production the public API lives under the app's origin (Caddy routes /api/v1 to the
  // backend); in dev there is no Caddy, so point straight at the backend.
  const apiBase = (
    process.env.PUBLIC_API_URL ??
    (process.env.NODE_ENV === 'development' ? process.env.BACKEND_URL ?? 'http://localhost:3000' : process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3100')
  ).replace(/\/$/, '');

  const usage = await usageLoad;
  const lock = lockOf(usage, 'api_keys');
  const requests = usage?.apiRequests;

  return (
    <div className="mx-auto max-w-3xl">
      <SettingsHeader title={t('title')} description={t('description')} />
      <TwoFactorNotice className="mt-4" />
      {(lock || requests?.limit != null) && (
        <p className="mt-4 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          {lock ? <PlanLock plan={lock} /> : requests?.limit != null && <span>{tPlan('apiRequests', { used: requests.used, limit: requests.limit })}</span>}
        </p>
      )}
      {!canManage(role) && (
        <Banner tone="info" className="mt-4">
          {t('readOnly')}
        </Banner>
      )}
      <ApiKeysManager initialKeys={keys} apiBase={apiBase} readOnly={!canManage(role)} />
    </div>
  );
}
