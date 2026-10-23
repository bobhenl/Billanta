import type { Metadata } from 'next';
import { ArrowRight, BadgeCheck, Building2, FileDown, Gift, MapPin, Users } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { AudienceHero, ClosingCta, SectionTitle } from '@/components/audience-page';
import { EmbedSection } from '@/components/embed-section';
import { CheckList, NextPages, NumberedSteps } from '@/components/learn-page';
import { FaqList, IconCards, faqLd } from '@/components/segment-page';
import { Link } from '@/i18n/navigation';
import { breadcrumbLd, jsonLd, publicPageMetadata } from '@/lib/seo';
import { CONTACT_EMAIL, SITE_NAME } from '@/lib/site';
import { REFERRAL_REWARDS } from '@/lib/referral';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'accountants' });
  return publicPageMetadata({ locale, path: '/for-accountants', title: t('seoTitle'), description: t('lead') });
}

/**
 * Partner programme for accountants and bookkeeping firms: what the
 * accountant role gives them in a client's company, the listing on the town
 * pages (opt-in via the public profile), the credits they earn per client
 * that starts paying (Settings → Invite for credits), and an invitation to
 * tell us what to build next. The FAQ is mirrored 1:1 in FAQPage data.
 */
const BENEFITS = [
  { icon: Users, key: 'access' },
  { icon: Building2, key: 'clients' },
  { icon: FileDown, key: 'exports' },
  { icon: BadgeCheck, key: 'included' },
  { icon: Gift, key: 'credits' },
  { icon: MapPin, key: 'directory' }
] as const;
const STEPS = ['signup', 'program', 'share'] as const;

export default async function AccountantsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('accountants');
  const tLearn = await getTranslations('learnPages.common');
  const credits = REFERRAL_REWARDS.accountant;
  const faq = (t.raw('faq') as { q: string; a: string }[]).map(({ q, a }) => ({
    q,
    a: a.replace('{welcome}', String(credits.welcome)).replace('{reward}', String(credits.reward))
  }));
  const mailto = CONTACT_EMAIL ? `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(t('shapeCta.mailSubject'))}` : null;
  const signup = { href: '/signup?for=accountant', label: t('cta') };

  return (
    <section className="container max-w-5xl py-10 sm:py-14">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={jsonLd([
          breadcrumbLd(locale, [
            [SITE_NAME, '/'],
            [t('title'), '/for-accountants']
          ]),
          faqLd(faq)
        ])}
      />
      <AudienceHero
        title={t('title')}
        lead={t('lead')}
        primary={signup}
        secondary={{ href: { pathname: '/demo', query: { view: 'accountant' } }, label: tLearn('demo') }}
      />

      <IconCards
        items={BENEFITS.map(({ icon, key }) => ({
          icon,
          title: t(`benefits.${key}.title`),
          body: t(`benefits.${key}.body`, { welcome: credits.welcome, reward: credits.reward })
        }))}
      />

      <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm font-semibold text-primary">
        <Link href="/invoicing" className="inline-flex items-center gap-1.5 hover:underline">
          {t('directoryCta.example')}
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Link>
        <Link href="/partners" className="inline-flex items-center gap-1.5 hover:underline">
          {t('partnersLink')}
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Link>
      </div>

      <SectionTitle title={t('stepsTitle')} />
      <NumberedSteps steps={STEPS.map((key) => ({ title: t(`steps.${key}.title`), body: t(`steps.${key}.body`) }))} />

      <NextPages
        title={tLearn('nextTitle')}
        items={(['roles', 'owners', 'assistants', 'advanced'] as const).map((key) => ({
          href: { roles: '/team-roles', owners: '/for-owners', assistants: '/for-assistants', advanced: '/invoicing-for-advanced' }[key],
          title: tLearn(`pages.${key}.title`),
          body: tLearn(`pages.${key}.body`)
        }))}
      />

      <FaqList title={t('faqTitle')} faq={faq} />

      {/* The credit rules matter to few readers, so they stay folded. */}
      <details className="mt-4 rounded-xl border border-border bg-card p-4">
        <summary className="cursor-pointer list-none font-semibold marker:hidden">{t('fine.title')}</summary>
        <CheckList items={t.raw('fine.points') as string[]} className="mt-3" />
      </details>

      <EmbedSection section="accountants" tabs={['badge']} badgeKinds={['partner']} className="mt-12" />

      <ClosingCta
        title={t('shapeCta.title')}
        body={t('shapeCta.body')}
        primary={signup}
        secondary={mailto ? { href: mailto, label: t('shapeCta.mail') } : null}
      />
    </section>
  );
}
