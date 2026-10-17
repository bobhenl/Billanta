import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Check } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { FEATURE_PAGES, getFeaturePage, relatedFeaturePages } from '@/lib/feature-pages';
import { jsonLd, publicPageMetadata } from '@/lib/seo';
import { SITE_NAME, SITE_URL } from '@/lib/site';

/**
 * One landing page per real feature (see `lib/feature-pages.ts`). Unlike
 * `/invoicing`, every page here has its own copy: what it does, the steps,
 * and an FAQ mirrored 1:1 in FAQPage structured data (both read the same
 * message keys, so the markup always describes visible text).
 */
type Params = { locale: string; slug: string };
type Faq = { q: string; a: string };

export function generateStaticParams() {
  return FEATURE_PAGES.map((f) => ({ slug: f.slug }));
}

export const dynamicParams = false;

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { locale, slug } = await params;
  const feature = getFeaturePage(slug);
  if (!feature) return {};
  const t = await getTranslations({ locale, namespace: 'featurePages' });
  return publicPageMetadata({
    locale,
    path: `/features/${slug}`,
    title: t(`items.${feature.key}.title`),
    description: t(`items.${feature.key}.description`)
  });
}

export default async function FeaturePage({ params }: { params: Promise<Params> }) {
  const { locale, slug } = await params;
  const feature = getFeaturePage(slug);
  if (!feature) notFound();

  const t = await getTranslations('featurePages');
  const k = `items.${feature.key}` as const;
  const points = t.raw(`${k}.points`) as string[];
  const steps = t.raw(`${k}.steps`) as string[];
  const faq = t.raw(`${k}.faq`) as Faq[];
  const Icon = feature.icon;
  const url = `${SITE_URL}/${locale}/features/${slug}`;

  const structuredData = [
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: SITE_NAME, item: `${SITE_URL}/${locale}` },
        { '@type': 'ListItem', position: 2, name: t('breadcrumb'), item: `${SITE_URL}/${locale}/features` },
        { '@type': 'ListItem', position: 3, name: t(`${k}.name`), item: url }
      ]
    },
    {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: faq.map(({ q, a }) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } }))
    }
  ];

  return (
    <section className="container py-12 sm:py-16">
      <script type="application/ld+json" dangerouslySetInnerHTML={jsonLd(structuredData)} />
      <nav aria-label="Breadcrumb" className="text-sm text-muted-foreground">
        <Link href="/features" className="hover:text-foreground">
          {t('breadcrumb')}
        </Link>
        <span className="mx-2">/</span>
        <span className="text-foreground">{t(`${k}.name`)}</span>
      </nav>

      <div className="mt-4 flex items-start gap-4">
        <span className="hidden h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary sm:flex">
          <Icon className="h-6 w-6" />
        </span>
        <div>
          <h1 className="max-w-3xl text-3xl font-semibold tracking-tight sm:text-4xl">{t(`${k}.title`)}</h1>
          <p className="mt-4 max-w-2xl text-lg text-muted-foreground">{t(`${k}.lead`)}</p>
        </div>
      </div>

      <div className="mt-10 grid gap-8 lg:grid-cols-2">
        <div>
          <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{t('pointsTitle')}</h2>
          <ul className="mt-4 space-y-3">
            {points.map((p) => (
              <li key={p} className="flex gap-3 text-sm leading-relaxed">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                {p}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{t('stepsTitle')}</h2>
          <ol className="mt-4 space-y-3">
            {steps.map((s, i) => (
              <li key={s} className="flex gap-3 text-sm leading-relaxed">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">
                  {i + 1}
                </span>
                {s}
              </li>
            ))}
          </ol>
        </div>
      </div>

      <div className="mt-10">
        <Link
          href="/signup"
          className="inline-flex items-center justify-center rounded-md bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground transition-colors hover:opacity-90"
        >
          {t('cta')}
        </Link>
        <p className="mt-2 text-sm text-muted-foreground">{t('ctaNote')}</p>
      </div>

      <div className="mt-14 max-w-3xl border-t border-border pt-8">
        <h2 className="text-xl font-semibold">{t('faqTitle')}</h2>
        <dl className="mt-4 divide-y divide-border">
          {faq.map(({ q, a }) => (
            <div key={q} className="py-4">
              <dt className="font-medium">{q}</dt>
              <dd className="mt-1 text-sm leading-relaxed text-muted-foreground">{a}</dd>
            </div>
          ))}
        </dl>
      </div>

      <nav aria-label={t('relatedTitle')} className="mt-12 border-t border-border pt-8">
        <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{t('relatedTitle')}</h2>
        <ul className="mt-4 flex flex-wrap gap-2">
          {relatedFeaturePages(slug).map((r) => (
            <li key={r.slug}>
              <Link
                href={`/features/${r.slug}`}
                className="inline-flex rounded-full border border-border bg-card px-4 py-2 text-sm font-medium hover:border-primary/40 hover:text-primary"
              >
                {t(`items.${r.key}.name`)}
              </Link>
            </li>
          ))}
          <li>
            <Link href="/features" className="inline-flex px-4 py-2 text-sm font-medium text-primary hover:underline">
              {t('allFeatures')} →
            </Link>
          </li>
        </ul>
      </nav>
    </section>
  );
}
