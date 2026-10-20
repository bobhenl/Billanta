import type { Metadata } from 'next';
import { ArrowRight, Briefcase, Check, Euro, FileSignature, Globe2, Repeat, Scale, Ticket } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { DemoCta } from '@/components/demo/demo-cta';
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
      <p className="text-sm font-bold uppercase tracking-wider text-primary">{t('eyebrow')}</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">{t('title')}</h1>
      <p className="mt-3 max-w-2xl text-base text-muted-foreground sm:text-lg">{t('lead')}</p>
      <div className="mt-6 flex flex-wrap gap-2">
        <Link href="/signup" className={buttonClass.primary}>
          {t('cta')}
        </Link>
        <Link href="/demo" className={buttonClass.secondary}>
          {t('demo')}
        </Link>
        <ShareQr />
      </div>

      <h2 className="mt-12 text-xl font-bold tracking-tight">{t('topicsTitle')}</h2>
      <IconCards items={TOPICS.map(({ icon, key }) => ({ icon, title: t(`topics.${key}.title`), body: t(`topics.${key}.body`) }))} />

      <div className="mt-12 grid gap-6 lg:grid-cols-2">
        <div>
          <h2 className="text-xl font-bold tracking-tight">{t('flatTax.title')}</h2>
          <p className="mt-2 text-sm text-muted-foreground">{t('flatTax.body')}</p>
          <ul className="mt-4 space-y-2 text-sm">
            {(t.raw('flatTax.points') as string[]).map((p) => (
              <li key={p} className="flex gap-2">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                {p}
              </li>
            ))}
          </ul>
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

      <DemoCta className="mt-12" />

      <div className="mt-12 rounded-2xl border border-primary/30 bg-primary/5 p-6 sm:p-8">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Ticket className="h-5 w-5" />
        </span>
        <h2 className="mt-3 text-xl font-bold tracking-tight">{t('partner.title')}</h2>
        <p className="mt-2 max-w-3xl text-sm text-muted-foreground sm:text-base">{t('partner.body')}</p>
        <ul className="mt-4 space-y-1.5 text-sm">
          {(t.raw('partner.points') as string[]).map((p) => (
            <li key={p} className="flex gap-2">
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
              {p}
            </li>
          ))}
        </ul>
        <div className="mt-5 flex flex-wrap gap-2">
          {mailto ? (
            <a href={mailto} className={buttonClass.primary}>
              {t('partner.cta')}
            </a>
          ) : (
            <Link href="/signup" className={buttonClass.primary}>
              {t('cta')}
            </Link>
          )}
        </div>
      </div>

      <FaqList title={t('faqTitle')} faq={faq} />
    </section>
  );
}
