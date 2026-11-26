import type { LucideIcon } from 'lucide-react';
import { ArrowRight, Check } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { AudienceHero, ClosingCta, SectionTitle } from '@/components/audience-page';
import { FaqList, IconCards, faqLd } from '@/components/segment-page';
import { Link } from '@/i18n/navigation';
import type { DemoAudienceKey } from '@/lib/demo-audiences';
import { REFERRAL_REWARDS } from '@/lib/referral';
import { breadcrumbLd, jsonLd } from '@/lib/seo';
import { CONTACT_EMAIL, SITE_NAME } from '@/lib/site';
import { cn } from '@/lib/utils';

/** The partner segment pages, keyed as in `partnerSegments.<key>` and lib/demo-audiences.ts. */
export type PartnerSegmentKey = 'courses' | 'coworkings' | 'communities' | 'expats' | 'banks';

const HOW_STEPS = ['code', 'share', 'scan', 'track'] as const;

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
        {HOW_STEPS.map((key, i) => (
          <li key={key} className="rounded-xl border border-border bg-card p-5">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">{i + 1}</span>
            <h3 className="mt-3 font-bold">{t(`steps.${key}.title`)}</h3>
            <p className="mt-1 text-sm text-muted-foreground">{t(`steps.${key}.body`, { reward: REFERRAL_REWARDS.friend.reward })}</p>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** Contact box: a prefilled e-mail when a contact address is configured, the about page otherwise. */
export async function PartnerContactCta({ subject, title, body }: { subject: string; title?: string; body?: string }) {
  const t = await getTranslations('partnerSegments.contact');
  const mailto = mailtoHref(subject);
  return (
    <ClosingCta
      title={title ?? t('title')}
      body={body ?? t('body')}
      primary={mailto ? { href: mailto, label: t('mail') } : { href: '/about', label: t('about') }}
    />
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
          faqLd(faq)
        ])}
      />
      <AudienceHero
        title={t('title')}
        lead={t('lead')}
        primary={mailto ? { href: mailto, label: tc('contact') } : { href: '/about', label: tc('contact') }}
        secondary={demo ? { href: demoHref, label: t('demoButton'), locale: demoLocale } : null}
      />

      <SectionTitle title={t('offerTitle')} />
      <IconCards
        items={offers.map(({ icon, key }) => ({
          icon,
          title: t(`offers.${key}.title`),
          body: t(`offers.${key}.body`, { reward: REFERRAL_REWARDS.friend.reward })
        }))}
      />

      {children}

      {how && <PartnerHowItWorks className="mt-12" />}

      <FaqList title={tc('faqTitle')} faq={faq} />

      <PartnerContactCta subject={t('mailSubject')} title={t('contactTitle')} body={t('contactBody')} />

      <p className="mt-6">
        <Link href="/for-partners" className="inline-flex items-center gap-1 text-sm font-semibold text-primary hover:underline">
          {tc('allSegments')}
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
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
