import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { DirectoryJoin } from '@/components/directory-join';
import { DirectoryListings, directoryItemListLd } from '@/components/directory-listings';
import { fetchDirectory, isThin, townsOf } from '@/lib/business-directory';
import { DIRECTORY_TRADES } from '@/lib/business-presets';
import { breadcrumbLd, jsonLd, publicPageMetadata } from '@/lib/seo';
import { SITE_NAME } from '@/lib/site';

type Props = { params: Promise<{ locale: string }> };

// Five minutes, like the fetch: a withdrawn listing must not linger.
export const revalidate = 300;

/** Newest few on the hub; the full lists live on the trade and town pages. */
const HUB_LISTINGS = 12;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'businessDirectory' });
  const metadata = publicPageMetadata({ locale, path: '/directory', title: t('seoTitle'), description: t('metaDescription', { site: SITE_NAME }) });
  return isThin(await fetchDirectory()) ? { ...metadata, robots: { index: false, follow: true } } : metadata;
}

/**
 * "Katalog firem": Billanta users who listed their public profile
 * (Settings → Public profile → "Zobrazit v katalogu firem"). Strictly
 * opt-in; the backend returns only those profiles and only public fields.
 * Thin views (fewer than MIN_INDEXED_LISTINGS) stay crawlable but noindex.
 */
export default async function DirectoryHubPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('businessDirectory');
  const listings = await fetchDirectory();
  const tradeLabel = (k: string) => t(`trades.${k}`);
  const towns = townsOf(listings).slice(0, 30);
  const tradeCounts = new Map<string, number>();
  for (const l of listings) tradeCounts.set(l.trade, (tradeCounts.get(l.trade) ?? 0) + 1);

  return (
    <section className="container max-w-5xl py-10 sm:py-14">
      <script type="application/ld+json" dangerouslySetInnerHTML={jsonLd(breadcrumbLd(locale, [[SITE_NAME, '/'], [t('title'), '/directory']]))} />
      {!isThin(listings) && (
        <script type="application/ld+json" dangerouslySetInnerHTML={jsonLd(directoryItemListLd(t('title'), '/directory', locale, listings.slice(0, HUB_LISTINGS), tradeLabel))} />
      )}
      <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{t('title')}</h1>
      <p className="mt-3 max-w-2xl text-base text-muted-foreground sm:text-lg">{t('lead', { site: SITE_NAME })}</p>

      <h2 className="mt-10 text-lg font-bold tracking-tight">{t('byTrade')}</h2>
      <ul className="mt-3 flex flex-wrap gap-2">
        {DIRECTORY_TRADES.map((key) => (
          <li key={key}>
            <Link href={`/directory/${key}`} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-sm hover:border-primary hover:text-primary">
              {tradeLabel(key)}
              {tradeCounts.get(key) ? <span className="text-xs text-muted-foreground">{tradeCounts.get(key)}</span> : null}
            </Link>
          </li>
        ))}
      </ul>

      {towns.length > 0 && (
        <>
          <h2 className="mt-10 text-lg font-bold tracking-tight">{t('byTown')}</h2>
          <ul className="mt-3 flex flex-wrap gap-2">
            {towns.map(({ municipality: m, count }) => (
              <li key={m.slug}>
                <Link href={`/directory/town/${m.slug}`} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-sm hover:border-primary hover:text-primary">
                  {m.name}
                  <span className="text-xs text-muted-foreground">{count}</span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}

      <h2 className="mt-10 text-lg font-bold tracking-tight">{t('latest')}</h2>
      <div className="mt-3">
        {listings.length > 0 ? (
          <DirectoryListings listings={listings.slice(0, HUB_LISTINGS)} locale={locale} tradeLabel={tradeLabel} />
        ) : (
          <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">{t('emptyAll')}</p>
        )}
      </div>

      <DirectoryJoin />
    </section>
  );
}
