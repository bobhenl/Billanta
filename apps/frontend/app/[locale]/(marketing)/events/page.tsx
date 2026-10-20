import type { Metadata } from 'next';
import { Building2, Check, Mail, PlayCircle, QrCode, Ticket } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { contactMailto, faqLd, FaqList, IconCards } from '@/components/segment-page';
import { ShareQr } from '@/components/share-qr';
import { Link } from '@/i18n/navigation';
import { breadcrumbLd, jsonLd, publicPageMetadata } from '@/lib/seo';
import { SITE_NAME } from '@/lib/site';
import { buttonClass } from '@/lib/ui-classes';

const PATH = '/events';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'events' });
  return publicPageMetadata({ locale, path: PATH, title: t('seoTitle'), description: t('lead') });
}

const OFFER = [
  { icon: Ticket, key: 'code' },
  { icon: QrCode, key: 'qr' },
  { icon: PlayCircle, key: 'demo' }
] as const;

/**
 * For organisers of meetups, coworkings and courses: we issue an event code
 * and a QR for the attendees, who can try the no-signup demo on the spot.
 * Coworkings get a standing code for all members instead. The share button
 * on this page draws the QR for a code typed in.
 */
export default async function EventsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('events');
  const faq = t.raw('faq') as { q: string; a: string }[];
  const mailto = contactMailto(t('contact.mailSubject'));

  return (
    <section className="container max-w-4xl py-10 sm:py-14">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={jsonLd([
          breadcrumbLd(locale, [
            [SITE_NAME, '/'],
            [t('title'), PATH]
          ]),
          faqLd(faq)
        ])}
      />
      <p className="text-sm font-bold uppercase tracking-wider text-primary">{t('eyebrow')}</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">{t('title')}</h1>
      <p className="mt-3 max-w-2xl text-base text-muted-foreground sm:text-lg">{t('lead')}</p>
      <div className="mt-6 flex flex-wrap gap-2">
        {mailto && (
          <a href={mailto} className={buttonClass.primary}>
            <Mail className="h-4 w-4" aria-hidden="true" />
            {t('contact.cta')}
          </a>
        )}
        <Link href="/demo" className={mailto ? buttonClass.secondary : buttonClass.primary}>
          {t('demoCta')}
        </Link>
        <ShareQr />
      </div>

      <h2 className="mt-12 text-xl font-bold tracking-tight">{t('offerTitle')}</h2>
      <IconCards items={OFFER.map(({ icon, key }) => ({ icon, title: t(`offer.${key}.title`), body: t(`offer.${key}.body`) }))} />

      <h2 className="mt-12 text-xl font-bold tracking-tight">{t('stepsTitle')}</h2>
      <ol className="mt-4 grid gap-4 sm:grid-cols-3">
        {(['write', 'print', 'scan'] as const).map((key, i) => (
          <li key={key} className="rounded-xl border border-border bg-card p-5">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">{i + 1}</span>
            <h3 className="mt-3 font-bold">{t(`steps.${key}.title`)}</h3>
            <p className="mt-1 text-sm text-muted-foreground">{t(`steps.${key}.body`)}</p>
          </li>
        ))}
      </ol>

      <div className="mt-12 rounded-2xl border border-border bg-card p-6 sm:p-8">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Building2 className="h-5 w-5" />
        </span>
        <h2 className="mt-3 text-xl font-bold tracking-tight">{t('coworking.title')}</h2>
        <p className="mt-2 max-w-3xl text-sm text-muted-foreground sm:text-base">{t('coworking.body')}</p>
        <ul className="mt-4 space-y-1.5 text-sm">
          {(t.raw('coworking.points') as string[]).map((p) => (
            <li key={p} className="flex gap-2">
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
              {p}
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-12 rounded-2xl border border-primary/30 bg-primary/5 p-6 sm:p-8">
        <h2 className="text-xl font-bold tracking-tight">{t('contact.title')}</h2>
        <p className="mt-2 max-w-3xl text-sm text-muted-foreground sm:text-base">{t('contact.body')}</p>
        <div className="mt-4 flex flex-wrap gap-2">
          {mailto ? (
            <a href={mailto} className={buttonClass.primary}>
              <Mail className="h-4 w-4" aria-hidden="true" />
              {t('contact.cta')}
            </a>
          ) : (
            <Link href="/demo" className={buttonClass.primary}>
              {t('demoCta')}
            </Link>
          )}
          <Link href="/for-schools" className={buttonClass.ghost}>
            {t('contact.schools')}
          </Link>
        </div>
      </div>

      <FaqList title={t('faqTitle')} faq={faq} />
    </section>
  );
}
