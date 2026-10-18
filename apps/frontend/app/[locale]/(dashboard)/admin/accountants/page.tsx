import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import { Link, redirect } from '@/i18n/navigation';
import { Banner } from '@/components/banner';
import { SettingsHeader } from '@/components/settings-header';
import { ApiError, apiFetch, NotSignedInError } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { ReviewQueue, type ReviewListing } from './review-queue';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('adminAccountants');
  return { title: t('title'), robots: { index: false, follow: false } };
}

const STATUSES = ['pending', 'approved', 'rejected', 'withdrawn'] as const;
type Status = (typeof STATUSES)[number];

/**
 * Billanta staff only: the review queue of the accountant directory. The
 * backend's PlatformAdminGuard decides who gets in; everyone else gets a
 * plain 404, so the page does not advertise itself.
 */
export default async function AdminAccountantsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const locale = await getLocale();
  const t = await getTranslations('adminAccountants');
  const query = await searchParams;
  const status: Status = (STATUSES as readonly string[]).includes(query.status ?? '') ? (query.status as Status) : 'pending';

  let listings: ReviewListing[];
  try {
    listings = await apiFetch<ReviewListing[]>(`/api/v1/admin/accountants?status=${status}`);
  } catch (error) {
    if (error instanceof NotSignedInError) redirect({ href: '/login', locale });
    if (error instanceof ApiError && (error.status === 401 || error.status === 403)) notFound();
    return <Banner tone="err" title={t('loadError')} className="mt-6" />;
  }

  return (
    <div className="mx-auto max-w-3xl">
      <SettingsHeader title={t('title')} description={t('description')} />
      <nav aria-label={t('statusLabel')} className="mt-5 flex flex-wrap gap-2">
        {STATUSES.map((s) => (
          <Link
            key={s}
            href={{ pathname: '/admin/accountants', query: s === 'pending' ? {} : { status: s } }}
            aria-current={s === status ? 'page' : undefined}
            className={cn(
              'rounded-full border px-3 py-1 text-sm font-semibold',
              s === status ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:bg-accent/50'
            )}
          >
            {t(`status.${s}`)}
          </Link>
        ))}
      </nav>
      <ReviewQueue listings={listings} />
    </div>
  );
}
