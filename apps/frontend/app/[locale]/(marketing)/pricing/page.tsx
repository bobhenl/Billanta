import type { Metadata } from 'next';
import { ArrowRight, Sparkles } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { breadcrumbLd, jsonLd, publicPageMetadata } from '@/lib/seo';
import { COMPARISON, defaultCurrency, PLANS } from '@/lib/plans';
import { SITE_NAME, SITE_URL } from '@/lib/site';
import { PricingPlans, type CompareCopy, type PlanCopy } from './pricing-plans';

/**
 * Pricing: four plans (prices in lib/plans.ts, wording in `pricing.*`),
 * switchable between yearly / monthly billing and CZK / EUR. The currency
 * starts from the locale: koruna for Czech, euro for Slovak and English.
 */
export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'pricing' });
  return publicPageMetadata({ locale, path: '/pricing', title: t('seoTitle'), description: t('metaDescription') });
}

export default async function PricingPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('pricing');
  const currency = defaultCurrency(locale);

  const copy: Record<string, PlanCopy> = Object.fromEntries(
    PLANS.map((plan) => [
      plan.key,
      {
        name: t(`plans.${plan.key}.name`),
        tagline: t(`plans.${plan.key}.tagline`),
        cta: t(`plans.${plan.key}.cta`),
        features: t.raw(`plans.${plan.key}.features`) as string[]
      }
    ])
  );

  const number = new Intl.NumberFormat(locale);
  const comparison: CompareCopy = {
    title: t('compare.title'),
    feature: t('compare.feature'),
    yes: t('compare.yes'),
    no: t('compare.no'),
    groups: COMPARISON.map(({ group, rows }) => ({
      label: t(`compare.groups.${group}`),
      rows: rows.map(([row, cells]) => ({
        label: t(`compare.rows.${row}`),
        // Raw so `{payg}` survives for the client to fill in the chosen currency.
        cells: cells.map((c) => (typeof c === 'number' ? number.format(c) : typeof c === 'string' ? (t.raw(`compare.cell.${c}`) as string) : c))
      }))
    }))
  };

  // One Offer per plan at its yearly-billed monthly price, in the currency
  // this locale shows first.
  const structuredData = [
    {
      '@context': 'https://schema.org',
      '@type': 'SoftwareApplication',
      name: SITE_NAME,
      url: `${SITE_URL}/${locale}`,
      applicationCategory: 'BusinessApplication',
      operatingSystem: 'Web',
      offers: PLANS.map((plan) => ({
        '@type': 'Offer',
        name: copy[plan.key]?.name ?? plan.key,
        price: String(plan.price[currency].yearly),
        priceCurrency: currency,
        url: `${SITE_URL}/${locale}/pricing`
      }))
    },
    breadcrumbLd(locale, [
      [SITE_NAME, '/'],
      [t('title'), '/pricing']
    ])
  ];

  return (
    <section className="container py-12 sm:py-16">
      <script type="application/ld+json" dangerouslySetInnerHTML={jsonLd(structuredData)} />
      <div className="max-w-2xl">
        <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">{t('title')}</h1>
        <p className="mt-3 text-muted-foreground">{t('lead')}</p>
      </div>

      <PricingPlans
        plans={PLANS}
        copy={copy}
        locale={locale}
        initialCurrency={currency}
        labels={{
          yearly: t('yearly'),
          monthly: t('monthly'),
          yearlySave: t('yearlySave'),
          period: t('period'),
          currency: t('currency'),
          perMonth: t('perMonth'),
          billedYearly: t.raw('billedYearly') as string,
          billedMonthly: t('billedMonthly'),
          forever: t('forever'),
          popular: t('popular'),
          paygNote: t.raw('paygNote') as string,
          aiCreditNote: t('aiCreditNote')
        }}
        comparison={comparison}
      />

      <div className="mt-6 flex flex-col gap-2 text-sm text-muted-foreground">
        <p className="flex items-start gap-2">
          <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
          {t('aiKeyNote')}
        </p>
        <p className="text-xs">{t('vatNote')}</p>
      </div>

      <Link href="/compare" className="mt-8 inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline">
        {t('compareCompetitors')}
        <ArrowRight className="h-4 w-4" aria-hidden="true" />
      </Link>
    </section>
  );
}
