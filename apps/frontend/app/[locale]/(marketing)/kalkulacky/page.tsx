import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
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
  return publicPageMetadata({ locale, path: '/kalkulacky', title: t('indexTitle'), description: t('indexDescription') });
}

export default async function CalculatorsHub({ params }: { params: Promise<Params> }) {
  const { locale } = await params;
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
      url: `${SITE_URL}/${locale}/kalkulacky/${c.slug}`
    }))
  };

  const card = 'group flex h-full gap-4 rounded-xl border border-border bg-card p-5 transition-colors hover:border-primary/40';
  return (
    <section className="container py-12 sm:py-16">
      <script type="application/ld+json" dangerouslySetInnerHTML={jsonLd(itemList)} />
      <h1 className="max-w-3xl text-3xl font-semibold tracking-tight sm:text-4xl">{t('calculators.indexTitle')}</h1>
      <p className="mt-4 max-w-2xl text-lg text-muted-foreground">{t('calculators.indexLead')}</p>

      <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {own.map((c) => {
          const Icon = c.icon;
          return (
            <li key={c.slug}>
              <Link href={`/kalkulacky/${c.slug}`} className={card}>
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
                  <Icon className="h-5 w-5" aria-hidden="true" />
                </span>
                <span>
                  <span className="block font-semibold group-hover:text-primary">{t(`calculators.items.${c.key}.name`)}</span>
                  <span className="mt-1 block text-sm text-muted-foreground">{t(`calculators.items.${c.key}.description`)}</span>
                </span>
              </Link>
            </li>
          );
        })}
        {czech.map((c) => {
          const Icon = c.icon;
          return (
            <li key={c.slug}>
              <Link href={`/kalkulacky/${c.slug}`} locale="cs" hrefLang="cs" className={card}>
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-secondary text-muted-foreground">
                  <Icon className="h-5 w-5" aria-hidden="true" />
                </span>
                <span>
                  <span className="block font-semibold group-hover:text-primary">{t(`calculators.items.${c.key}.name`)}</span>
                  <span className="mt-1 inline-flex rounded-full bg-secondary px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {t('common.czTag')}
                  </span>
                  <span className="mt-1 block text-sm text-muted-foreground">{t(`calculators.items.${c.key}.description`)}</span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>

      {guides.length > 0 && (
        <div className="mt-12">
          <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{t('common.relatedGuides')}</h2>
          <ul className="mt-4 flex flex-wrap gap-2">
            {guides.map((g) => (
              <li key={g.slug}>
                <Link
                  href={`/navody/${g.slug}`}
                  className="inline-flex rounded-full border border-border bg-card px-4 py-2 text-sm font-medium hover:border-primary/40 hover:text-primary"
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
