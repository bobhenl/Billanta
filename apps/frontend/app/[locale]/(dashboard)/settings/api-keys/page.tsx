import type { Metadata } from 'next';
import { getLocale, getTranslations } from 'next-intl/server';
import { redirect } from '@/i18n/navigation';
import { Banner } from '@/components/banner';
import { TwoFactorNotice } from '@/components/two-factor-notice';
import { SettingsHeader } from '@/components/settings-header';
import { apiFetch, NotSignedInError } from '@/lib/api-client';
import { canManage, fetchMayEditSettings, fetchMyRole, fetchUsage } from '@/lib/tenant';
import { lockOf } from '@/lib/usage';
import { PlanLock } from '@/components/plan-lock';
import { ApiKeysManager, type ApiKeyListItem } from './api-keys-manager';
import { settingsGate } from '@/components/settings-gate';
import { publicApiBase } from '@/lib/public-api';
import { Link } from '@/i18n/navigation';
import { Bot, ChevronRight } from 'lucide-react';

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

  const apiBase = publicApiBase();

  // Owners and admins, or a member with this settings section (Settings → Team).
  const editable = canManage(role) || (role !== null && (await fetchMayEditSettings('apiKeys')));
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
      {!editable && (
        <Banner tone="info" className="mt-4">
          {t('readOnly')}
        </Banner>
      )}
      <ApiKeysManager initialKeys={keys} apiBase={apiBase} readOnly={!editable} />
      <Link href="/settings/api-keys/mcp" className="mt-4 flex items-center gap-3 rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary sm:p-5">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-secondary text-primary">
          <Bot className="h-5 w-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-bold">{t('mcp.linkTitle')}</span>
          <span className="block text-sm text-muted-foreground">{t('mcp.linkDescription')}</span>
        </span>
        <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" />
      </Link>
    </div>
  );
}
