import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { apiFetch } from '@/lib/api-client';
import type { AiSettings } from '../../invoices/new/types';
import { AiSettingsForm } from './ai-settings-form';
import { settingsGate } from '@/components/settings-gate';
import { SettingsHeader } from '@/components/settings-header';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('settings.ai');
  return { title: t('title') };
}

export default async function AiSettingsPage() {
  const gate = await settingsGate('ai');
  if (gate) return gate;
  const t = await getTranslations('settings.ai');
  const settings = await apiFetch<AiSettings>('/api/v1/ai/settings').catch(() => null);

  return (
    <div className="mx-auto max-w-3xl">
      <SettingsHeader title={t('title')} description={t('lead')} />
      <div className="mt-6">
        {settings ? <AiSettingsForm initial={settings} /> : <p className="text-sm text-destructive">{t('loadError')}</p>}
      </div>
    </div>
  );
}
