import type { Metadata } from 'next';
import { ArrowRight } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { FEATURE_PAGES } from '@/lib/feature-pages';
import { jsonLd, publicPageMetadata } from '@/lib/seo';
import { SITE_URL } from '@/lib/site';
import { buttonClass } from '@/lib/ui-classes';
import { cn } from '@/lib/utils';

/** The audience pages, for visitors who are not the ones invoicing (an accountant, a coworking, a teacher). */
const AUDIENCES = [
  ['accountants', '/for-accountants'],
  ['partners', '/for-partners'],
  ['coworkings', '/for-coworkings'],
  ['schools', '/for-schools']
] as const;

/** Hub of the feature landing pages – one card (and one crawlable link) per feature. */
export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'featurePages' });
  return publicPageMetadata({ locale, path: '/features', title: t('indexSeoTitle'), description: t('indexDescription') });
}

export default async function FeaturesIndexPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
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
      <h1 className="max-w-3xl text-3xl font-extrabold tracking-tight sm:text-4xl">{t('indexHeading')}</h1>
      <p className="mt-3 max-w-2xl text-muted-foreground sm:text-lg">{t('indexLead')}</p>

      <ul className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {FEATURE_PAGES.map(({ slug, key }) => (
          <li key={slug}>
            <Link
              href={`/features/${slug}`}
              className="group flex h-full flex-col rounded-xl border border-border bg-card p-5 transition-colors hover:border-primary/40"
            >
              <h2 className="flex items-center justify-between gap-2 text-base font-bold">
                {t(`items.${key}.name`)}
                <ArrowRight
                  className="h-4 w-4 shrink-0 text-muted-foreground transition-colors group-hover:text-primary"
                  aria-hidden="true"
                />
              </h2>
              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{t(`items.${key}.description`)}</p>
            </Link>
          </li>
        ))}
      </ul>

      <div className="mt-12">
        <Link href="/signup" className={cn(buttonClass.primary, 'w-full px-6 py-3 sm:w-auto')}>
          {t('cta')}
        </Link>
        <p className="mt-2 text-sm text-muted-foreground">{t('ctaNote')}</p>
        <p className="mt-4 text-sm text-muted-foreground">
          {t('demo.text')}{' '}
          <Link href="/demo" className="inline-flex items-center gap-1 font-semibold text-primary hover:underline">
            {t('demo.link')}
            <ArrowRight className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          </Link>
        </p>
      </div>

      <nav aria-label={t('audiences.title')} className="mt-12 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border pt-6 text-sm">
        <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{t('audiences.title')}</h2>
        {AUDIENCES.map(([key, href]) => (
          <Link key={key} href={href} className="font-medium text-primary hover:underline">
            {t(`audiences.${key}`)}
          </Link>
        ))}
      </nav>
    </section>
  );
}
