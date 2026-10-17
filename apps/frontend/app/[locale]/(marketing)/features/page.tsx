import type { Metadata } from 'next';
import { ArrowRight } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { FEATURE_PAGES } from '@/lib/feature-pages';
import { jsonLd, publicPageMetadata } from '@/lib/seo';
import { SITE_URL } from '@/lib/site';

/** Hub of the feature landing pages — one card (and one crawlable link) per feature. */
export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'featurePages' });
  return publicPageMetadata({ locale, path: '/features', title: t('indexSeoTitle'), description: t('indexDescription') });
}

export default async function FeaturesIndexPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations('featurePages');

  const structuredData = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    itemListElement: FEATURE_PAGES.map((f, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: t(`items.${f.key}.name`),
      url: `${SITE_URL}/${locale}/features/${f.slug}`
    }))
  };

  return (
    <section className="container py-12 sm:py-16">
      <script type="application/ld+json" dangerouslySetInnerHTML={jsonLd(structuredData)} />
      <h1 className="max-w-3xl text-3xl font-semibold tracking-tight sm:text-4xl">{t('indexHeading')}</h1>
      <p className="mt-4 max-w-2xl text-lg text-muted-foreground">{t('indexLead')}</p>

      <ul className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {FEATURE_PAGES.map(({ slug, key, icon: Icon }) => (
          <li key={slug}>
            <Link
              href={`/features/${slug}`}
              className="group flex h-full flex-col rounded-xl border border-border bg-card p-5 transition-colors hover:border-primary/40"
            >
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/15 text-primary">
                <Icon className="h-[18px] w-[18px]" />
              </span>
              <h2 className="mt-3 text-base font-bold">{t(`items.${key}.name`)}</h2>
              <p className="mt-1 flex-1 text-sm leading-relaxed text-muted-foreground">{t(`items.${key}.description`)}</p>
              <span className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-primary">
                {t('more')}
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
              </span>
            </Link>
          </li>
        ))}
      </ul>

      <div className="mt-12">
        <Link
          href="/signup"
          className="inline-flex items-center justify-center rounded-md bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground transition-colors hover:opacity-90"
        >
          {t('cta')}
        </Link>
        <p className="mt-2 text-sm text-muted-foreground">{t('ctaNote')}</p>
      </div>
    </section>
  );
}
