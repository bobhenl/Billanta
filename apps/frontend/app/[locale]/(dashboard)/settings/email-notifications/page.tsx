import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Banner } from '@/components/banner';
import { SettingsHeader } from '@/components/settings-header';
import { fetchEmailPrefs } from '@/lib/email-prefs-actions';
import { fetchMyNewsletter } from '@/lib/newsletter-actions';
import { EmailNotificationSettings } from './email-notification-settings';
import { NewsletterSettings } from './newsletter-settings';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('settings.emailNotifications');
  return { title: t('title') };
}

/** Settings → E-mailová upozornění: every e-mail type, the weekly digest and quiet hours, per member, plus the newsletter. */
export default async function EmailNotificationsPage() {
  const t = await getTranslations('settings.emailNotifications');
  const [prefs, newsletter] = await Promise.all([fetchEmailPrefs(), fetchMyNewsletter()]);
  return (
    <div className="mx-auto max-w-3xl">
      <SettingsHeader title={t('title')} description={t('description')} />
      {prefs ? <EmailNotificationSettings prefs={prefs} /> : <Banner tone="err" title={t('loadError')} className="mt-6" />}
      {newsletter && <NewsletterSettings initial={newsletter} />}
    </div>
  );
}
