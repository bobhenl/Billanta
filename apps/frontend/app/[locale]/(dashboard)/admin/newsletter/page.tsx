import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import { redirect } from '@/i18n/navigation';
import { Banner } from '@/components/banner';
import { SettingsHeader } from '@/components/settings-header';
import { ApiError, apiFetch, NotSignedInError } from '@/lib/api-client';
import type { AdminIssue } from './actions';
import { NewsletterAdmin, type NewsletterStats } from './newsletter-admin';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('adminNewsletter');
  return { title: t('title'), robots: { index: false, follow: false } };
}

/**
 * Billanta staff only: the newsletter for subscribers with confirmed
 * consent. The backend's PlatformAdminGuard decides who gets in; everyone
 * else gets a plain 404.
 */
export default async function AdminNewsletterPage() {
  const locale = await getLocale();
  const t = await getTranslations('adminNewsletter');

  let stats: NewsletterStats;
  let issues: AdminIssue[];
  try {
    [stats, issues] = await Promise.all([
      apiFetch<NewsletterStats>('/api/v1/admin/newsletter/stats'),
      apiFetch<AdminIssue[]>('/api/v1/admin/newsletter/issues')
    ]);
  } catch (error) {
    if (error instanceof NotSignedInError) redirect({ href: '/login', locale });
    if (error instanceof ApiError && (error.status === 401 || error.status === 403)) notFound();
    return <Banner tone="err" title={t('loadError')} className="mt-6" />;
  }

  return (
    <div className="mx-auto max-w-4xl">
      <SettingsHeader title={t('title')} description={t('description')} />
      <NewsletterAdmin stats={stats} issues={issues} />
    </div>
  );
}
