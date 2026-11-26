import type { Metadata } from 'next';
import { ArrowRight, Briefcase, Euro, FileSignature, Globe2, Repeat, Scale } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { AudienceHero, SectionTitle } from '@/components/audience-page';
import { CheckList } from '@/components/learn-page';
import { contactMailto, faqLd, FaqList, IconCards } from '@/components/segment-page';
import { ShareQr } from '@/components/share-qr';
import { Link } from '@/i18n/navigation';
import { CALCULATORS, GUIDES, isPublishedIn } from '@/lib/public-tools';
import { breadcrumbLd, jsonLd, publicPageMetadata } from '@/lib/seo';
import { SITE_NAME } from '@/lib/site';
import { buttonClass } from '@/lib/ui-classes';

const PATH = '/for-creators';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'creators' });
  return publicPageMetadata({ locale, path: PATH, title: t('seoTitle'), description: t('lead') });
}

const TOPICS = [
  { icon: Briefcase, key: 'brands' },
  { icon: Euro, key: 'eur' },
  { icon: Scale, key: 'reverseCharge' },
  { icon: Globe2, key: 'abroad' },
  { icon: FileSignature, key: 'advance' },
  { icon: Repeat, key: 'recurring' }
] as const;

/** Feature pages that answer the questions above, then the tax calculators and guides published in this language. */
const FEATURE_LINKS = [
  { href: '/features/foreign-currency-invoices', key: 'currencies' },
  { href: '/features/bilingual-invoices', key: 'bilingual' },
  { href: '/features/quotes-and-proforma-invoices', key: 'quotes' },
  { href: '/features/tax-estimate', key: 'taxEstimate' }
] as const;
const CALCULATOR_SLUGS = ['flat-tax', 'slovak-self-employed-tax', 'cnb-exchange-rates'];
const GUIDE_SLUGS = ['identified-person'];

/**
 * For creators and influencers who invoice brands and agencies, often
 * abroad and in euros. The partner section is for creators who want a promo
 * code for their audience: codes are issued by us, so it is a contact, not
 * a form.
 */
export default async function CreatorsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('creators');
  const tTools = await getTranslations('tools');
  const faq = t.raw('faq') as { q: string; a: string }[];
  const mailto = contactMailto(t('partner.mailSubject'));
  const calculators = CALCULATORS.filter((c) => CALCULATOR_SLUGS.includes(c.slug) && isPublishedIn(c, locale));
  const guides = GUIDES.filter((g) => GUIDE_SLUGS.includes(g.slug) && isPublishedIn(g, locale));
  const links = [
    ...FEATURE_LINKS.map(({ href, key }) => ({ href, label: t(`links.${key}`) })),
    ...calculators.map((c) => ({ href: `/calculators/${c.slug}`, label: tTools(`calculators.items.${c.key}.name`) })),
    ...guides.map((g) => ({ href: `/guides/${g.slug}`, label: tTools(`guides.items.${g.key}.name`) }))
  ];

  return (
    <section className="container max-w-5xl py-10 sm:py-14">
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
      <AudienceHero title={t('title')} lead={t('lead')} primary={{ href: '/signup', label: t('cta') }} secondary={{ href: '/demo', label: t('demo') }} />

      <SectionTitle title={t('topicsTitle')} />
      <IconCards items={TOPICS.map(({ icon, key }) => ({ icon, title: t(`topics.${key}.title`), body: t(`topics.${key}.body`) }))} />

      <div className="mt-12 grid gap-6 lg:grid-cols-2">
        <div>
          <h2 className="text-xl font-bold tracking-tight">{t('flatTax.title')}</h2>
          <p className="mt-2 text-sm text-muted-foreground">{t('flatTax.body')}</p>
          <CheckList items={t.raw('flatTax.points') as string[]} className="mt-4" />
        </div>
        <div className="rounded-2xl border border-border bg-card p-6">
          <h2 className="text-lg font-bold tracking-tight">{t('linksTitle')}</h2>
          <ul className="mt-3 space-y-2 text-sm">
            {links.map(({ href, label }) => (
              <li key={href}>
                <Link href={href} className="inline-flex items-center gap-1.5 font-semibold text-primary hover:underline">
                  {label}
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* A side offer for creators with an audience, so a secondary button: the page's primary action stays sign-up. */}
      <div className="mt-12 rounded-2xl border border-border bg-card p-6">
        <h2 className="text-xl font-bold tracking-tight">{t('partner.title')}</h2>
        <p className="mt-2 max-w-3xl text-sm text-muted-foreground">{t('partner.body')}</p>
        <CheckList items={t.raw('partner.points') as string[]} className="mt-4" />
        {mailto && (
          <a href={mailto} className={`${buttonClass.secondary} mt-5`}>
            {t('partner.cta')}
          </a>
        )}
      </div>

      <FaqList title={t('faqTitle')} faq={faq} />

      <ShareQr className="mt-10" />
    </section>
  );
}
