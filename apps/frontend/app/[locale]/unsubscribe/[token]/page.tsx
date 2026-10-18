import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Banner } from '@/components/banner';
import { fetchUnsubscribePreview } from '@/lib/email-unsubscribe';
import { NOINDEX } from '@/lib/seo';
import { UnsubscribeButton } from './unsubscribe-button';

// The token identifies a member: never indexed, no referrer to whatever they click next.
export const metadata: Metadata = { robots: NOINDEX, referrer: 'no-referrer' };
export const dynamic = 'force-dynamic';

/**
 * Footer link from a notification or digest e-mail. No session needed;
 * the signed token says who and what. Opening the page changes nothing,
 * the member confirms with the button.
 */
export default async function UnsubscribePage({ params }: { params: Promise<{ locale: string; token: string }> }) {
  const { token } = await params;
  const t = await getTranslations('unsubscribe');
  const tApp = await getTranslations('app');
  const preview = await fetchUnsubscribePreview(token);
  const what = preview.ok ? (t.has(`types.${preview.type}`) ? t(`types.${preview.type}`) : t('types.all')) : '';

  return (
    <div className="mx-auto max-w-lg px-4 py-12 sm:py-16">
      <p className="mb-8 text-center text-sm font-medium text-muted-foreground">{tApp('name')}</p>
      <div className="rounded-lg border border-border bg-card p-6 sm:p-8">
        <h1 className="text-xl font-semibold tracking-tight">{t('title')}</h1>
        {!preview.ok ? (
          <Banner tone="err" title={t(`errors.${preview.error}`)} className="mt-4" />
        ) : (
          <>
            <p className="mt-3 text-sm text-muted-foreground">
              {preview.companyName ? t('intro', { what, company: preview.companyName }) : t('introNoCompany', { what })}
            </p>
            <UnsubscribeButton token={token} already={preview.unsubscribed} />
          </>
        )}
      </div>
    </div>
  );
}
