import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { DirectoryJoin } from '@/components/directory-join';
import { DirectoryListings, directoryItemListLd } from '@/components/directory-listings';
import { isThin, listingsForTown } from '@/lib/business-directory';
import { DIRECTORY_TRADES } from '@/lib/business-presets';
import { getMunicipalityBySlug, municipalityLocale } from '@/lib/municipalities';
import { breadcrumbLd, jsonLd, publicPageMetadata } from '@/lib/seo';
import { SITE_NAME, SITE_URL } from '@/lib/site';

type Props = { params: Promise<{ locale: string; slug: string }> };

// Rendered on demand (thousands of municipalities, most with no listing) and cached.
export const revalidate = 300;
export const dynamicParams = true;
export function generateStaticParams() {
  return [];
}

/**
 * Listed profiles of one municipality. Like /invoicing/[slug], the page is
 * indexed only in the language of the town's country, and only with at
 * least MIN_INDEXED_LISTINGS listings; anything thinner is noindex.
 */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, slug } = await params;
  const m = getMunicipalityBySlug(slug);
  if (!m) return {};
  const t = await getTranslations({ locale, namespace: 'businessDirectory' });
  const path = `/directory/town/${slug}`;
  const metadata = publicPageMetadata({ locale, path, title: t('townSeoTitle', { name: m.name }), description: t('townMetaDescription', { name: m.name, site: SITE_NAME }) });
  const home = `${SITE_URL}/${municipalityLocale(m)}${path}`;
  const alternates = { ...metadata.alternates, languages: { [municipalityLocale(m)]: home, 'x-default': home } };
  const indexed = locale === municipalityLocale(m) && !isThin(await listingsForTown(m));
  return indexed ? { ...metadata, alternates } : { ...metadata, alternates, robots: { index: false, follow: true } };
}

export default async function DirectoryTownPage({ params }: Props) {
  const { locale, slug } = await params;
  const m = getMunicipalityBySlug(slug);
  if (!m) notFound();
  setRequestLocale(locale);
  const t = await getTranslations('businessDirectory');
  const tradeLabel = (k: string) => t(`trades.${k}`);
  const listings = await listingsForTown(m);
  const path = `/directory/town/${slug}`;
  const trades = DIRECTORY_TRADES.filter((k) => listings.some((l) => l.trade === k));

  return (
    <section className="container max-w-5xl py-10 sm:py-14">
      <script type="application/ld+json" dangerouslySetInnerHTML={jsonLd(breadcrumbLd(locale, [[SITE_NAME, '/'], [t('title'), '/directory'], [m.name, path]]))} />
      {!isThin(listings) && (
        <script type="application/ld+json" dangerouslySetInnerHTML={jsonLd(directoryItemListLd(t('townTitle', { name: m.name }), path, locale, listings, tradeLabel))} />
      )}
      <nav aria-label="Breadcrumb" className="text-sm text-muted-foreground">
        <Link href="/directory" className="hover:text-foreground">
          {t('title')}
        </Link>
        <span className="mx-2">/</span>
        <span className="text-foreground">{m.name}</span>
      </nav>
      <h1 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">{t('townTitle', { name: m.name })}</h1>
      <p className="mt-3 max-w-2xl text-base text-muted-foreground sm:text-lg">
        {t('townIntro', { name: m.name, district: m.district, region: m.region, site: SITE_NAME })}
      </p>
      {listings.length > 0 && <p className="mt-6 text-sm text-muted-foreground">{t('count', { n: listings.length })}</p>}

      <div className="mt-3">
        {listings.length > 0 ? (
          <DirectoryListings listings={listings} locale={locale} tradeLabel={tradeLabel} showTown={false} />
        ) : (
          <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">{t('emptyTown', { name: m.name })}</p>
        )}
      </div>

      {trades.length > 0 && (
        <>
          <h2 className="mt-10 text-lg font-bold tracking-tight">{t('townTrades')}</h2>
          <ul className="mt-3 flex flex-wrap gap-2">
            {trades.map((k) => (
              <li key={k}>
                <Link href={`/directory/${k}`} className="inline-flex rounded-full border border-border bg-card px-3 py-1.5 text-sm hover:border-primary hover:text-primary">
                  {tradeLabel(k)}
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}

      <p className="mt-10 text-sm">
        <Link href={`/invoicing/${m.slug}`} className="font-semibold text-primary hover:underline">
          {t('townInvoicing', { name: m.name })}
        </Link>
      </p>

      <DirectoryJoin />
    </section>
  );
}
