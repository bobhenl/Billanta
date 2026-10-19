import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { DirectoryJoin } from '@/components/directory-join';
import { DirectoryListings, directoryItemListLd } from '@/components/directory-listings';
import { fetchDirectory, isThin, townsOf } from '@/lib/business-directory';
import { DIRECTORY_TRADES, isDirectoryTrade } from '@/lib/business-presets';
import { breadcrumbLd, jsonLd, publicPageMetadata } from '@/lib/seo';
import { SITE_NAME } from '@/lib/site';

type Props = { params: Promise<{ locale: string; trade: string }> };

export const revalidate = 300;

export function generateStaticParams() {
  return DIRECTORY_TRADES.map((trade) => ({ trade }));
}

export const dynamicParams = false;

const listingsOf = async (trade: string) => (await fetchDirectory()).filter((l) => l.trade === trade);

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, trade } = await params;
  if (!isDirectoryTrade(trade)) return {};
  const t = await getTranslations({ locale, namespace: 'businessDirectory' });
  const label = t(`trades.${trade}`);
  const metadata = publicPageMetadata({ locale, path: `/directory/${trade}`, title: t('tradeSeoTitle', { trade: label }), description: t(`tradeIntro.${trade}`) });
  return isThin(await listingsOf(trade)) ? { ...metadata, robots: { index: false, follow: true } } : metadata;
}

/** One trade of the business directory, e.g. /directory/it. */
export default async function DirectoryTradePage({ params }: Props) {
  const { locale, trade } = await params;
  if (!isDirectoryTrade(trade)) notFound();
  setRequestLocale(locale);
  const t = await getTranslations('businessDirectory');
  const tradeLabel = (k: string) => t(`trades.${k}`);
  const label = tradeLabel(trade);
  const listings = await listingsOf(trade);
  const towns = townsOf(listings).slice(0, 20);
  const path = `/directory/${trade}`;

  return (
    <section className="container max-w-5xl py-10 sm:py-14">
      <script type="application/ld+json" dangerouslySetInnerHTML={jsonLd(breadcrumbLd(locale, [[SITE_NAME, '/'], [t('title'), '/directory'], [label, path]]))} />
      {!isThin(listings) && <script type="application/ld+json" dangerouslySetInnerHTML={jsonLd(directoryItemListLd(label, path, locale, listings, tradeLabel))} />}
      <nav aria-label="Breadcrumb" className="text-sm text-muted-foreground">
        <Link href="/directory" className="hover:text-foreground">
          {t('title')}
        </Link>
        <span className="mx-2">/</span>
        <span className="text-foreground">{label}</span>
      </nav>
      <h1 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">{label}</h1>
      <p className="mt-3 max-w-2xl text-base text-muted-foreground sm:text-lg">{t(`tradeIntro.${trade}`)}</p>
      {listings.length > 0 && <p className="mt-6 text-sm text-muted-foreground">{t('count', { n: listings.length })}</p>}

      <div className="mt-3">
        {listings.length > 0 ? (
          <DirectoryListings listings={listings} locale={locale} tradeLabel={tradeLabel} />
        ) : (
          <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">{t('emptyTrade')}</p>
        )}
      </div>

      {towns.length > 0 && (
        <>
          <h2 className="mt-10 text-lg font-bold tracking-tight">{t('tradeTowns', { trade: label })}</h2>
          <ul className="mt-3 flex flex-wrap gap-2">
            {towns.map(({ municipality: m }) => (
              <li key={m.slug}>
                <Link href={`/directory/town/${m.slug}`} className="inline-flex rounded-full border border-border bg-card px-3 py-1.5 text-sm hover:border-primary hover:text-primary">
                  {m.name}
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}

      <h2 className="mt-10 text-lg font-bold tracking-tight">{t('otherTrades')}</h2>
      <ul className="mt-3 flex flex-wrap gap-2">
        {DIRECTORY_TRADES.filter((k) => k !== trade).map((k) => (
          <li key={k}>
            <Link href={`/directory/${k}`} className="inline-flex rounded-full border border-border bg-card px-3 py-1.5 text-sm hover:border-primary hover:text-primary">
              {tradeLabel(k)}
            </Link>
          </li>
        ))}
      </ul>

      <DirectoryJoin />
    </section>
  );
}
