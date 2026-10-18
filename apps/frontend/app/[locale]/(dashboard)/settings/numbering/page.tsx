import type { Metadata } from 'next';
import { getLocale, getTranslations } from 'next-intl/server';
import { redirect } from '@/i18n/navigation';
import { Banner } from '@/components/banner';
import { SettingsHeader } from '@/components/settings-header';
import { apiFetch, NotSignedInError } from '@/lib/api-client';
import { canManage, fetchMyRole } from '@/lib/tenant';
import type { NumberFormatsView } from '../actions';
import { NumberFormatsEditor } from './number-formats-editor';
import { settingsGate } from '@/components/settings-gate';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('settings.numbering');
  return { title: t('title') };
}

/** Settings → Číslování dokladů: own number pattern and next number per document type. */
export default async function NumberingSettingsPage() {
  const gate = await settingsGate('numbering');
  if (gate) return gate;
  const locale = await getLocale();
  const t = await getTranslations('settings.numbering');

  let role: string | null;
  let view: NumberFormatsView | null = null;
  try {
    role = await fetchMyRole();
    if (canManage(role)) view = await apiFetch<NumberFormatsView>('/api/v1/tenants/me/number-formats');
  } catch (error) {
    if (error instanceof NotSignedInError) redirect({ href: '/login', locale });
    return <Banner tone="err" title={t('loadError')} className="mt-6" />;
  }

  return (
    <div className="mx-auto max-w-3xl">
      <SettingsHeader title={t('title')} description={t('description')} />
      {view ? (
        <NumberFormatsEditor view={view} />
      ) : (
        <Banner tone="info" className="mt-4">
          {t('readOnly')}
        </Banner>
      )}
    </div>
  );
}
