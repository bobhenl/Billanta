import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Banner } from '@/components/banner';
import { TwoFactorNotice } from '@/components/two-factor-notice';
import { SettingsHeader } from '@/components/settings-header';
import { fetchIntegrations } from '@/lib/integration-actions';
import { IntegrationsSettings } from './integrations-settings';
import { settingsGate } from '@/components/settings-gate';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('settings.integrations');
  return { title: t('title') };
}

/** Settings → Integrace: calendar & RSS feeds, webhooks (Discord, Slack, JSON) and the API. */
export default async function IntegrationsPage() {
  const gate = await settingsGate('integrations');
  if (gate) return gate;
  const t = await getTranslations('settings.integrations');
  const state = await fetchIntegrations();
  const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3100').replace(/\/$/, '');
  return (
    <div className="mx-auto max-w-3xl">
      <SettingsHeader title={t('title')} description={t('description')} />
      <TwoFactorNotice className="mt-4" />
      {state ? <IntegrationsSettings initial={state} siteUrl={siteUrl} /> : <Banner tone="err" title={t('loadError')} className="mt-6" />}
    </div>
  );
}
