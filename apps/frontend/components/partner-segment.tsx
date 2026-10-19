import type { LucideIcon } from 'lucide-react';
import { BarChart3, Check, Mail, PlayCircle, QrCode, ScanLine, Ticket } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import type { DemoAudienceKey } from '@/lib/demo-audiences';
import { REFERRAL_REWARDS } from '@/lib/referral';
import { breadcrumbLd, jsonLd } from '@/lib/seo';
import { CONTACT_EMAIL, SITE_NAME } from '@/lib/site';
import { buttonClass } from '@/lib/ui-classes';
import { cn } from '@/lib/utils';

/** The partner segment pages, keyed as in `partnerSegments.<key>` and lib/demo-audiences.ts. */
export type PartnerSegmentKey = 'courses' | 'coworkings' | 'communities' | 'expats' | 'banks';

const HOW_STEPS = [
  { key: 'code', icon: Ticket },
  { key: 'share', icon: QrCode },
  { key: 'scan', icon: ScanLine },
  { key: 'track', icon: BarChart3 }
] as const;

function mailtoHref(subject: string) {
  return CONTACT_EMAIL ? `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(subject)}` : null;
}

/**
 * "How it works for partners": one code from us, a QR, poster or link for
 * the group, members scan and are in on their own, the partner sees sign-ups
 * and earns credit. The codes are the generic group codes at `/join/CODE`.
 */
export async function PartnerHowItWorks({ className }: { className?: string }) {
  const t = await getTranslations('partnerSegments.how');
  return (
    <div className={className}>
      <h2 className="text-xl font-bold tracking-tight">{t('title')}</h2>
      <p className="mt-2 max-w-3xl text-sm text-muted-foreground">{t('lead')}</p>
      <ol className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {HOW_STEPS.map(({ key, icon: Icon }, i) => (
          <li key={key} className="rounded-xl border border-border bg-card p-5">
            <span className="flex items-center gap-2 text-sm font-bold text-primary">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-primary-foreground">{i + 1}</span>
              <Icon className="h-4 w-4" aria-hidden="true" />
            </span>
            <h3 className="mt-3 font-bold">{t(`steps.${key}.title`)}</h3>
            <p className="mt-1 text-sm text-muted-foreground">{t(`steps.${key}.body`, { reward: REFERRAL_REWARDS.friend.reward })}</p>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** Contact box: a prefilled e-mail when a contact address is configured, the about page otherwise. */
export async function PartnerContactCta({ subject, title, body, className }: { subject: string; title?: string; body?: string; className?: string }) {
  const t = await getTranslations('partnerSegments.contact');
  const mailto = mailtoHref(subject);
  return (
    <div className={cn('rounded-2xl border border-primary/30 bg-primary/5 p-6 sm:p-8', className)}>
      <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <Mail className="h-5 w-5" />
      </span>
      <h2 className="mt-3 text-xl font-bold tracking-tight">{title ?? t('title')}</h2>
      <p className="mt-2 max-w-3xl text-sm text-muted-foreground sm:text-base">{body ?? t('body')}</p>
      <div className="mt-4">
        {mailto ? (
          <a href={mailto} className={buttonClass.primary}>
            {t('mail')}
          </a>
        ) : (
          <Link href="/about" className={buttonClass.primary}>
            {t('about')}
          </Link>
        )}
      </div>
    </div>
  );
}

/**
 * One partner segment page: who it is for, what we offer the partner and
 * its members, how the group code works, an optional page-specific section,
 * FAQ (mirrored in FAQPage data) and contact. `demo: false` for pages that
 * only invite a conversation (banks); `demoLocale` opens the demo in another
 * language (the expats page always opens it in English).
 */
export async function PartnerSegmentPage({
  locale,
  segment,
  offers,
  demo = true,
  demoLocale,
  how = true,
  children
}: {
  locale: string;
  segment: PartnerSegmentKey;
  offers: { key: string; icon: LucideIcon }[];
  demo?: boolean;
  demoLocale?: string;
  how?: boolean;
  children?: React.ReactNode;
}) {
  const t = await getTranslations(`partnerSegments.${segment}`);
  const tc = await getTranslations('partnerSegments.common');
  const path = `/for-${segment}`;
  const faq = t.raw('faq') as { q: string; a: string }[];
  const mailto = mailtoHref(t('mailSubject'));
  const audience: DemoAudienceKey = segment;
  const demoHref = { pathname: '/demo', query: { for: audience } };

  return (
    <section className="container max-w-5xl py-10 sm:py-14">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={jsonLd([
          breadcrumbLd(locale, [
            [SITE_NAME, '/'],
            [tc('hubCrumb'), '/for-partners'],
            [t('title'), path]
          ]),
          {
            '@context': 'https://schema.org',
            '@type': 'FAQPage',
            mainEntity: faq.map(({ q, a }) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } }))
          }
        ])}
      />
      <p className="text-sm font-bold uppercase tracking-wider text-primary">{t('eyebrow')}</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">{t('title')}</h1>
      <p className="mt-3 max-w-2xl text-base text-muted-foreground sm:text-lg">{t('lead')}</p>
      <div className="mt-6 flex flex-wrap gap-2">
        {mailto ? (
          <a href={mailto} className={buttonClass.primary}>
            {tc('contact')}
          </a>
        ) : (
          <Link href="/about" className={buttonClass.primary}>
            {tc('contact')}
          </Link>
        )}
        {demo && (
          <Link href={demoHref} locale={demoLocale} className={cn(buttonClass.secondary, 'inline-flex items-center gap-1.5')}>
            <PlayCircle className="h-4 w-4" aria-hidden="true" />
            {t('demoButton')}
          </Link>
        )}
      </div>

      <h2 className="mt-12 text-xl font-bold tracking-tight">{t('offerTitle')}</h2>
      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {offers.map(({ icon: Icon, key }) => (
          <div key={key} className="rounded-xl border border-border bg-card p-5">
            <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Icon className="h-5 w-5" />
            </span>
            <h3 className="mt-3 font-bold">{t(`offers.${key}.title`)}</h3>
            <p className="mt-1 text-sm text-muted-foreground">{t(`offers.${key}.body`, { reward: REFERRAL_REWARDS.friend.reward })}</p>
          </div>
        ))}
      </div>

      {children}

      {how && <PartnerHowItWorks className="mt-12" />}

      <h2 className="mt-12 text-xl font-bold tracking-tight">{tc('faqTitle')}</h2>
      <div className="mt-4 divide-y divide-border rounded-xl border border-border bg-card">
        {faq.map(({ q, a }) => (
          <details key={q} className="group p-4">
            <summary className="cursor-pointer list-none font-semibold marker:hidden">{q}</summary>
            <p className="mt-2 text-sm text-muted-foreground">{a}</p>
          </details>
        ))}
      </div>

      <PartnerContactCta subject={t('mailSubject')} title={t('contactTitle')} body={t('contactBody')} className="mt-12" />

      <p className="mt-6 text-sm">
        <Link href="/for-partners" className="font-medium text-primary hover:underline">
          {tc('allSegments')} →
        </Link>
      </p>
    </section>
  );
}

/** A checklist block for page-specific sections. */
export function PartnerChecklist({ title, lead, points, children, className }: { title: string; lead?: string; points: string[]; children?: React.ReactNode; className?: string }) {
  return (
    <div className={cn('rounded-2xl border border-border bg-card p-6', className)}>
      <h2 className="text-xl font-bold tracking-tight">{title}</h2>
      {lead && <p className="mt-2 text-sm text-muted-foreground">{lead}</p>}
      <ul className="mt-4 space-y-2 text-sm">
        {points.map((p) => (
          <li key={p} className="flex gap-2">
            <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
            {p}
          </li>
        ))}
      </ul>
      {children}
    </div>
  );
}
