import type { Metadata } from 'next';
import { ArrowLeft, Gift, LogIn, Mail } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { auth } from '@/auth';
import { PosterSheet } from '@/components/poster-sheet';
import { PrintButton } from '@/components/print-button';
import { Link } from '@/i18n/navigation';
import { apiFetch } from '@/lib/api-client';
import { posterPrintCss, POSTER_LANGS, POSTER_SIZES, posterUrl, type PosterLang, type PosterOptions } from '@/lib/posters';
import { REFERRAL_CODE } from '@/lib/referral';
import { CONTACT_EMAIL } from '@/lib/site';
import { cn } from '@/lib/utils';

type Params = { locale: string };

/** The sizes a coworking wall needs; the admin generator has the flyers too. */
const SIZES = ['a4', 'a3'] as const;

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'coworkingPoster' });
  // A print tool, and for a signed-in visitor a personal one (their invite
  // code): nothing to rank. The /for-coworkings page is the indexed one.
  // `follow` so the links on it still count; not in the sitemap.
  return { title: t('title'), description: t('lead'), robots: { index: false, follow: true } };
}

// Reads the session for the invite code.
export const dynamic = 'force-dynamic';

/** The signed-in company's invite code, or none (signed out, a demo, no company yet, backend down). */
async function inviteCode(): Promise<string | null> {
  const session = await auth().catch(() => null);
  if (!session?.user || session.isDemo) return null;
  const overview = await apiFetch<{ code?: unknown }>('/api/v1/referrals').catch(() => null);
  return typeof overview?.code === 'string' && REFERRAL_CODE.test(overview.code) ? overview.code : null;
}

/**
 * The poster /for-coworkings talks about, ready to print or save as PDF
 * from the browser's print dialog, in A4 or A3. Signed in, the QR carries
 * the company's invite code, so the coworking earns the referral credit;
 * otherwise it leads to the home page. A group code for all members with
 * a member benefit is still set up by us on request (the contact link).
 */
export default async function CoworkingPosterPage({ params, searchParams }: { params: Promise<Params>; searchParams: Promise<{ size?: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('coworkingPoster');
  const { size: sizeParam } = await searchParams;
  const size = SIZES.find((s) => s === sizeParam) ?? 'a4';
  const ref = await inviteCode();
  const lang: PosterLang = POSTER_LANGS.find((l) => l === locale) ?? 'cs';
  const options: PosterOptions = { template: 'coworking', lang, target: 'home', size, promo: '', event: '', tabs: false, ref: ref ?? undefined };
  const mailto = CONTACT_EMAIL ? `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(t('mailSubject'))}` : null;

  return (
    <section className="container max-w-5xl py-10 sm:py-14">
      <style dangerouslySetInnerHTML={{ __html: posterPrintCss(POSTER_SIZES[size].page) }} />
      <Link href="/for-coworkings" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        {t('back')}
      </Link>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">{t('title')}</h1>
      <p className="mt-3 max-w-2xl text-muted-foreground">{t('lead')}</p>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <div role="group" aria-label={t('sizeLabel')} className="inline-flex rounded-full border border-border bg-card p-1">
          {SIZES.map((s) => (
            <Link
              key={s}
              href={{ pathname: '/for-coworkings/poster', query: s === 'a4' ? {} : { size: s } }}
              aria-current={s === size ? 'true' : undefined}
              className={cn(
                'rounded-full px-4 py-1.5 text-sm font-semibold transition-colors',
                s === size ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {s.toUpperCase()}
            </Link>
          ))}
        </div>
        <PrintButton label={t('download')} />
      </div>
      <p className="mt-2 text-xs text-muted-foreground">{t('printHint')}</p>

      <div className="mt-4 rounded-xl border border-border bg-card p-4 text-sm">
        {ref ? (
          <p className="flex gap-2">
            <Gift className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
            <span>{t('withInvite', { code: ref })}</span>
          </p>
        ) : (
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <LogIn className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
            <span>{t('generic')}</span>
            <Link href="/login" className="font-semibold text-primary hover:underline">
              {t('login')}
            </Link>
          </p>
        )}
        <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-muted-foreground">
          <Mail className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{t('groupCode')}</span>
          {mailto && (
            <a href={mailto} className="font-semibold text-primary hover:underline">
              {t('contact')}
            </a>
          )}
        </p>
        <p className="mt-2 break-all text-xs text-muted-foreground">
          {t('qrTarget')} {posterUrl(options)}
        </p>
      </div>

      {/* The sheet keeps its real size in mm; on a phone the preview scrolls inside its box, not the page. */}
      <div className="mt-6 overflow-auto rounded-xl border border-border bg-muted p-4">
        <div className="w-max shadow-lg">
          <PosterSheet options={options} />
        </div>
      </div>
    </section>
  );
}
