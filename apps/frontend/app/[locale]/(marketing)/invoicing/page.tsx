import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { getAllMunicipalities, getRegionGroups, regionAnchorId } from '@/lib/municipalities';
import { breadcrumbLd, jsonLd, publicPageMetadata, webPageLd } from '@/lib/seo';
import { SITE_NAME } from '@/lib/site';

/**
 * Directory/browse page for the `/invoicing/[slug]` municipality landing
 * pages. This exists so every municipality page is reachable through real
 * on-site links (country -> region -> municipality), not only through
 * `app/sitemap.ts` — genuine crawlable internal linking is part of this
 * feature's doorway-page mitigation, alongside the honesty notes on the
 * municipality pages themselves (see that file's top comment).
 */

export const revalidate = 2592000; // 30 days — same rationale as the [slug] page.

type Params = { locale: string };

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'municipalityPages' });
  const metadata = publicPageMetadata({ locale, path: '/invoicing', title: t('indexTitle'), description: t('indexLead') });
  // Town pages are written for Czech and Slovak visitors; the English directory is for browsing only.
  return locale === 'en' ? { ...metadata, robots: { index: false, follow: true } } : metadata;
}

export default async function MunicipalityIndexPage({ params }: { params: Promise<Params> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('municipalityPages');
  // cs lists Czech municipalities, sk Slovak ones (each town page is indexed in its own language).
  const country = locale === 'cs' ? 'CZ' : locale === 'sk' ? 'SK' : null;
  const groups = getRegionGroups().filter((g) => !country || g.country === country);
  const total = getAllMunicipalities().filter((m) => !country || m.country === country).length;

  return (
    <>
        <section className="container py-16 sm:py-24">
          <script
            type="application/ld+json"
            dangerouslySetInnerHTML={jsonLd([
              webPageLd(locale, '/invoicing', 'CollectionPage', t('indexTitle'), t('indexLead')),
              breadcrumbLd(locale, [
                [SITE_NAME, '/'],
                [t('breadcrumbBrowse'), '/invoicing']
              ])
            ])}
          />
          <h1 className="max-w-2xl text-3xl font-semibold tracking-tight sm:text-4xl">
            {t('indexTitle')}
          </h1>
          <p className="mt-4 max-w-2xl text-lg text-muted-foreground">{t('indexLead')}</p>
          <p className="mt-2 text-sm text-muted-foreground">
            {t('indexCoverageNote', { count: total })}
            {country && (
              <>
                {' '}
                <Link href="/invoicing" locale={country === 'CZ' ? 'sk' : 'cs'} className="font-medium text-primary hover:underline">
                  {t('otherCountry')}
                </Link>
              </>
            )}
          </p>

          <div className="mt-12 grid gap-10 lg:grid-cols-2">
            {groups.map((group) => {
              const anchorId = regionAnchorId(group.country, group.region);
              const countryLabel = group.country === 'CZ' ? t('countryCz') : t('countrySk');

              return (
                <section
                  key={anchorId}
                  id={anchorId}
                  className="scroll-mt-20 rounded-lg border border-border bg-card p-6 shadow-sm"
                >
                  <h2 className="font-semibold text-card-foreground">
                    {group.region} <span className="font-normal text-muted-foreground">– {countryLabel}</span>
                  </h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {t('regionMunicipalityCount', { count: group.municipalities.length })}
                  </p>

                  <details className="mt-4 group">
                    <summary className="cursor-pointer text-sm font-medium text-primary">
                      {t('expandListLabel')}
                    </summary>
                    <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-sm">
                      {group.municipalities.map((m) => (
                        <li key={m.slug}>
                          <Link
                            href={`/invoicing/${m.slug}`}
                            className="text-muted-foreground transition-colors hover:text-foreground hover:underline"
                          >
                            {m.name}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </details>
                </section>
              );
            })}
          </div>
        </section>
      </>
  );
}
