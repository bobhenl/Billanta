import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Banner } from '@/components/banner';
import { SettingsHeader } from '@/components/settings-header';
import { fetchNotificationPrefs } from '@/lib/notification-actions';
import { NotificationSettings } from './notification-settings';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('settings.notifications');
  return { title: t('title') };
}

/** Settings → Notifikace: per member, which events reach them and how. */
export default async function NotificationSettingsPage() {
  const t = await getTranslations('settings.notifications');
  const prefs = await fetchNotificationPrefs();
  return (
    <div className="mx-auto max-w-3xl">
      <SettingsHeader title={t('title')} description={t('description')} />
      {prefs ? <NotificationSettings prefs={prefs} /> : <Banner tone="err" title={t('loadError')} className="mt-6" />}
    </div>
  );
}
