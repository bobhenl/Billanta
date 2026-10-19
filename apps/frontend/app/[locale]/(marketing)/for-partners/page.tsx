import type { Metadata } from 'next';
import { ArrowRight, Building2, Calculator, CalendarDays, Globe2, GraduationCap, Landmark, Megaphone, School, UsersRound } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { EmbedSection } from '@/components/embed-section';
import { PartnerContactCta, PartnerHowItWorks } from '@/components/partner-segment';
import { SkEinvoicingCallout } from '@/components/public-tools/sk-einvoicing-callout';
import { Link } from '@/i18n/navigation';
import { breadcrumbLd, jsonLd, publicPageMetadata } from '@/lib/seo';
import { SITE_NAME } from '@/lib/site';
import { buttonClass } from '@/lib/ui-classes';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'partnerSegments.hub' });
  return publicPageMetadata({ locale, path: '/for-partners', title: t('seoTitle'), description: t('lead') });
}

/**
 * Every partner programme on one page. Schools, creators and events have
 * their own pages (/for-schools, /for-creators, /events); the partner
 * directory of companies that work with us stays at /partners.
 */
const SEGMENTS = [
  { key: 'courses', href: '/for-courses', icon: GraduationCap },
  { key: 'coworkings', href: '/for-coworkings', icon: Building2 },
  { key: 'communities', href: '/for-communities', icon: UsersRound },
  { key: 'expats', href: '/for-expats', icon: Globe2 },
  { key: 'schools', href: '/for-schools', icon: School },
  { key: 'creators', href: '/for-creators', icon: Megaphone },
  { key: 'events', href: '/events', icon: CalendarDays },
  { key: 'accountants', href: '/for-accountants', icon: Calculator },
  { key: 'banks', href: '/for-banks', icon: Landmark }
] as const;

export default async function ForPartnersPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('partnerSegments.hub');

  return (
    <section className="container max-w-5xl py-10 sm:py-14">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={jsonLd(
          breadcrumbLd(locale, [
            [SITE_NAME, '/'],
            [t('title'), '/for-partners']
          ])
        )}
      />
      <p className="text-sm font-bold uppercase tracking-wider text-primary">{t('eyebrow')}</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">{t('title')}</h1>
      <p className="mt-3 max-w-2xl text-base text-muted-foreground sm:text-lg">{t('lead')}</p>

      <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {SEGMENTS.map(({ key, href, icon: Icon }) => (
          <li key={key}>
            <Link href={href} className="group flex h-full flex-col rounded-xl border border-border bg-card p-5 transition-colors hover:border-primary hover:shadow-md">
              <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Icon className="h-5 w-5" />
              </span>
              <span className="mt-3 font-bold">{t(`segments.${key}.title`)}</span>
              <span className="mt-1 flex-1 text-sm text-muted-foreground">{t(`segments.${key}.body`)}</span>
              <span className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-primary">
                {t('more')}
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
              </span>
            </Link>
          </li>
        ))}
      </ul>

      {/* Accountants and associations get asked about the 2027 mandate first. */}
      <SkEinvoicingCallout partner className="mt-8" />

      <PartnerHowItWorks className="mt-12" />

      <EmbedSection section="partners" tabs={['badge']} badgeKinds={['partner', 'customer']} className="mt-12" />

      <PartnerContactCta subject={t('mailSubject')} className="mt-12" />

      <div className="mt-8 flex flex-wrap gap-2">
        <Link href="/partners" className={buttonClass.secondary}>
          {t('directory')}
        </Link>
      </div>
    </section>
  );
}
