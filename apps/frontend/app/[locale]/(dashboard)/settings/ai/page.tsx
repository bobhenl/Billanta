import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { apiFetch } from '@/lib/api-client';
import type { AiSettings } from '../../invoices/new/types';
import { AiSettingsForm } from './ai-settings-form';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('settings.ai');
  return { title: t('title') };
}

export default async function AiSettingsPage() {
  const t = await getTranslations('settings.ai');
  const settings = await apiFetch<AiSettings>('/api/v1/ai/settings').catch(() => null);

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-extrabold tracking-tight">{t('title')}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{t('lead')}</p>
      <div className="mt-6">
        {settings ? <AiSettingsForm initial={settings} /> : <p className="text-sm text-destructive">{t('loadError')}</p>}
      </div>
    </div>
  );
}
