import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { ToolTabs } from '@/components/public-tools/tool-tabs';
import { SignupCta } from '@/components/public-tools/parts';
import { CALCULATORS, GUIDES, isPublishedIn } from '@/lib/public-tools';
import { jsonLd, publicPageMetadata } from '@/lib/seo';
import { SITE_URL } from '@/lib/site';

/**
 * Hub of the public calculators. Indexed in every language: the Slovak copy
 * lists the VAT, minimums and ČNB calculators as its own and the Czech-only
 * ones (OSVČ, paušální daň) with a "Czech rules" tag, linking straight to
 * the Czech page instead of to the sk notice. The ItemList carries only the
 * entries that are pages of this language.
 */
type Params = { locale: string };

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'tools.calculators' });
  return publicPageMetadata({ locale, path: '/calculators', title: t('indexTitle'), description: t('indexDescription') });
}

export default async function CalculatorsHub({ params }: { params: Promise<Params> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('tools');
  const own = CALCULATORS.filter((c) => isPublishedIn(c, locale));
  const czech = CALCULATORS.filter((c) => !isPublishedIn(c, locale));
  const guides = GUIDES.filter((g) => isPublishedIn(g, locale));

  const itemList = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: t('calculators.indexTitle'),
    itemListElement: own.map((c, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: t(`calculators.items.${c.key}.name`),
      url: `${SITE_URL}/${locale}/calculators/${c.slug}`
    }))
  };

  const card = 'group block h-full rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary/40 sm:p-5';
  return (
    <section className="container py-6 sm:py-12">
      <script type="application/ld+json" dangerouslySetInnerHTML={jsonLd(itemList)} />
      <ToolTabs kind="calculators" />
      <h1 className="max-w-3xl text-2xl font-extrabold tracking-tight sm:text-4xl">{t('calculators.indexTitle')}</h1>
      <p className="mt-2 max-w-2xl text-base text-muted-foreground sm:mt-4 sm:text-lg">{t('calculators.indexLead')}</p>

      <ul className="mt-6 grid gap-3 sm:mt-10 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3">
        {own.map((c) => (
          <li key={c.slug}>
            <Link href={`/calculators/${c.slug}`} className={card}>
              <span className="block font-semibold group-hover:text-primary">{t(`calculators.items.${c.key}.name`)}</span>
              <span className="mt-1 block text-sm text-muted-foreground">{t(`calculators.items.${c.key}.description`)}</span>
            </Link>
          </li>
        ))}
        {czech.map((c) => (
          <li key={c.slug}>
            <Link href={`/calculators/${c.slug}`} locale="cs" hrefLang="cs" className={card}>
              <span className="block font-semibold group-hover:text-primary">
                {t(`calculators.items.${c.key}.name`)} <span className="text-xs font-normal text-muted-foreground">· {t('common.czTag')}</span>
              </span>
              <span className="mt-1 block text-sm text-muted-foreground">{t(`calculators.items.${c.key}.description`)}</span>
            </Link>
          </li>
        ))}
      </ul>

      {guides.length > 0 && (
        <div className="mt-12">
          <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{t('common.relatedGuides')}</h2>
          <ul className="mt-4 grid gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
            {guides.map((g) => (
              <li key={g.slug}>
                <Link
                  href={`/guides/${g.slug}`}
                  className="text-sm font-medium hover:text-primary hover:underline"
                >
                  {t(`guides.items.${g.key}.name`)}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-12">
        <SignupCta />
      </div>
    </section>
  );
}
