import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Banner } from '@/components/banner';
import { NEWSLETTER_CONFIRM_TOKEN, type NewsletterTopic } from '@/lib/newsletter';
import { NOINDEX } from '@/lib/seo';
import { ConfirmButton } from './confirm-button';

// The token is a personal link: never indexed, no referrer to whatever is clicked next.
export const metadata: Metadata = { robots: NOINDEX, referrer: 'no-referrer' };
export const dynamic = 'force-dynamic';

const BACKEND_URL = (process.env.BACKEND_URL ?? 'http://localhost:3000').replace(/\/$/, '');

type Preview =
  | { ok: true; status: 'pending' | 'confirmed'; email: string; topics: NewsletterTopic[] }
  | { ok: false; error: 'invalid_confirm_link' | 'confirm_link_expired' | 'unavailable' };

/** Read-only: mail scanners open links, so GET never confirms. */
async function fetchPreview(token: string): Promise<Preview> {
  if (!NEWSLETTER_CONFIRM_TOKEN.test(token)) return { ok: false, error: 'invalid_confirm_link' };
  try {
    const res = await fetch(`${BACKEND_URL}/api/v1/public/newsletter/confirm/${encodeURIComponent(token)}`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(8000)
    });
    if (res.status === 400) {
      const body = (await res.json().catch(() => null)) as { message?: string } | null;
      return { ok: false, error: body?.message === 'confirm_link_expired' ? 'confirm_link_expired' : 'invalid_confirm_link' };
    }
    if (!res.ok) return { ok: false, error: 'unavailable' };
    const body = (await res.json()) as { status: 'pending' | 'confirmed'; email: string; topics: NewsletterTopic[] };
    return { ok: true, ...body };
  } catch {
    return { ok: false, error: 'unavailable' };
  }
}

/**
 * Second step of the double opt-in, linked from the confirmation e-mail.
 * The visitor confirms with the button; only then does the address get
 * anything but that one e-mail.
 */
export default async function NewsletterConfirmPage({ params }: { params: Promise<{ locale: string; token: string }> }) {
  const { token } = await params;
  const t = await getTranslations('newsletter');
  const tApp = await getTranslations('app');
  const preview = await fetchPreview(token);

  return (
    <div className="mx-auto max-w-lg px-4 py-12 sm:py-16">
      <p className="mb-8 text-center text-sm font-medium text-muted-foreground">{tApp('name')}</p>
      <div className="rounded-lg border border-border bg-card p-6 sm:p-8">
        <h1 className="text-xl font-semibold tracking-tight">{t('confirm.title')}</h1>
        {!preview.ok ? (
          <Banner tone="err" title={t(`confirm.errors.${preview.error}`)} className="mt-4" />
        ) : (
          <>
            <p className="mt-3 text-sm text-muted-foreground">{t('confirm.intro', { email: preview.email })}</p>
            <ul className="mt-2 list-disc pl-5 text-sm">
              {preview.topics.map((topic) => (
                <li key={topic}>{t(`signup.topics.${topic}`)}</li>
              ))}
            </ul>
            <ConfirmButton token={token} already={preview.status === 'confirmed'} />
          </>
        )}
      </div>
    </div>
  );
}
