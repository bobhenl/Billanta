import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import {
  direction,
  distanceKm,
  getBuildTimeMunicipalities,
  getDistrictNeighbours,
  getDistrictSeat,
  getMunicipalityBySlug,
  getNearbyMunicipalities,
  getRegionSeat,
  getSocialSecurityOffice,
  getTaxOffice,
  isDistrictSeat,
  isIndexedMunicipality,
  municipalityLocale,
  regionAnchorId,
  type Municipality
} from '@/lib/municipalities';
import { breadcrumbLd, jsonLd, publicPageMetadata } from '@/lib/seo';
import { SITE_NAME, SITE_URL } from '@/lib/site';

/**
 * Local-SEO landing page — one per real Czech/Slovak municipality. See
 * `apps/frontend/data/README.md` for the data source and
 * `apps/frontend/lib/municipalities.ts` for how the (small) build-time set
 * vs. the (much larger) on-demand set is decided.
 *
 * Doorway-page risk: the product does not differ by municipality. What
 * makes each page its own is real data computed from the dataset — the
 * nearest places with distances, where the town lies against its district
 * and regional seat, the district's other municipalities and the competent
 * tax office. The page deliberately does NOT:
 *   - claim any town-specific customer count, testimonial, or usage stat
 *     (there is no such data, and inventing it would be a false claim);
 *   - emit LocalBusiness/postal-address structured data, since Billanta has
 *     no physical presence in any of these towns;
 *   - pretend the product behaves differently here (`localNote` says so).
 * Each page is indexed only in its own language (see isIndexedMunicipality).
 * If Google's spam policies ever require pulling this route, everything
 * lives under this `invoicing` segment plus `data/municipalities.json`
 * and `lib/municipalities.ts`.
 */

type Params = { locale: string; slug: string };

// Statically pre-render only the district seats (the largest, most-searched
// places, including both capitals). Every other municipality page is
// rendered on first request and then cached — see `revalidate` below. An
// on-demand ISR page is served as the same fully-rendered HTML to Googlebot.
export function generateStaticParams() {
  return getBuildTimeMunicipalities().map((m) => ({ slug: m.slug }));
}

// Allow slugs outside the build-time set to be rendered on demand instead of
// 404ing.
export const dynamicParams = true;

// Static per municipality (no live data): a long window is enough to pick up
// copy/template changes on redeploy.
export const revalidate = 2592000; // 30 days

export async function generateMetadata({
  params
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { locale, slug } = await params;
  const municipality = getMunicipalityBySlug(slug);
  if (!municipality) return {};

  const t = await getTranslations({ locale, namespace: 'municipalityPages' });
  const metadata = publicPageMetadata({
    locale,
    path: `/invoicing/${slug}`,
    title: t('heading', { name: municipality.name }),
    description: t('metaDescription', { name: municipality.name, district: municipality.district, region: municipality.region })
  });
  // The page exists in one language only; the other locales are not alternates of it.
  const home = `${SITE_URL}/${municipalityLocale(municipality)}/invoicing/${slug}`;
  const alternates = { ...metadata.alternates, languages: { [municipalityLocale(municipality)]: home, 'x-default': home } };
  return isIndexedMunicipality(municipality, locale)
    ? { ...metadata, alternates }
    : { ...metadata, alternates, robots: { index: false, follow: true } };
}

const km = (value: number) => (value < 10 ? Math.round(value * 10) / 10 : Math.round(value));

export default async function MunicipalityPage({ params }: { params: Promise<Params> }) {
  const { locale, slug } = await params;
  setRequestLocale(locale);
  const municipality = getMunicipalityBySlug(slug);
  if (!municipality) {
    notFound();
  }

  const t = await getTranslations('municipalityPages');
  const countryLabel = municipality.country === 'CZ' ? t('countryCz') : t('countrySk');
  const socialOffice = getSocialSecurityOffice(municipality);
  const regionHref = `/invoicing#${regionAnchorId(municipality.country, municipality.region)}`;
  const seat = getDistrictSeat(municipality);
  const regionSeat = getRegionSeat(municipality);
  const nearby = getNearbyMunicipalities(municipality, 10);
  const district = getDistrictNeighbours(municipality, new Set(nearby.map((n) => n.municipality.slug)));

  /** "12 km north-east of X", or null when the coordinates are missing or it is X itself. */
  const position = (from: Municipality | undefined, key: 'seatPosition' | 'regionPosition') => {
    if (!from || from.slug === municipality.slug) return null;
    const d = distanceKm(from, municipality);
    const dir = direction(from, municipality);
    if (d == null || dir == null || d < 1) return null;
    return (
      <>
        {t(key, { km: km(d), dir })}{' '}
        <Link href={`/invoicing/${from.slug}`} className="font-medium text-primary hover:underline">
          {from.name}
        </Link>
      </>
    );
  };
  const seatLine = isDistrictSeat(municipality) ? t('isDistrictSeat', { district: municipality.district }) : position(seat, 'seatPosition');
  const regionLine = regionSeat?.slug === municipality.slug ? t('isRegionSeat', { region: municipality.region }) : position(regionSeat, 'regionPosition');
  const mapHref =
    municipality.lat != null && municipality.lon != null
      ? `https://www.openstreetmap.org/?mlat=${municipality.lat.toFixed(5)}&mlon=${municipality.lon.toFixed(5)}#map=13/${municipality.lat.toFixed(5)}/${municipality.lon.toFixed(5)}`
      : null;

  return (
    <>
        <section className="container py-16 sm:py-24">
          <script
            type="application/ld+json"
            dangerouslySetInnerHTML={jsonLd(
              breadcrumbLd(locale, [
                [SITE_NAME, '/'],
                [t('breadcrumbBrowse'), '/invoicing'],
                [municipality.name, `/invoicing/${slug}`]
              ])
            )}
          />
          <nav aria-label="Breadcrumb" className="text-sm text-muted-foreground">
            <Link href="/invoicing" className="hover:text-foreground">
              {t('breadcrumbBrowse')}
            </Link>
            <span className="mx-2">/</span>
            <span className="text-foreground">{municipality.name}</span>
          </nav>

          <h1 className="mt-4 max-w-3xl text-3xl font-semibold tracking-tight sm:text-4xl">
            {t('heading', { name: municipality.name })}
          </h1>
          <p className="mt-4 max-w-2xl text-lg text-muted-foreground">
            {t('lead', { name: municipality.name })}
          </p>

          <dl className="mt-8 flex flex-wrap gap-x-10 gap-y-3 text-sm">
            <div>
              <dt className="text-muted-foreground">{t('regionLabel')}</dt>
              <dd className="font-medium text-foreground">{municipality.region}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t('districtLabel')}</dt>
              <dd className="font-medium text-foreground">{municipality.district}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t('countryLabel')}</dt>
              <dd className="font-medium text-foreground">{countryLabel}</dd>
            </div>
          </dl>

          <Link
            href="/signup"
            className="mt-8 inline-flex items-center justify-center rounded-md bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground transition-colors hover:opacity-90"
          >
            {t('cta')}
          </Link>

          <div className="mt-14 grid max-w-4xl gap-6 border-t border-border pt-8 md:grid-cols-2">
            <div>
              <h2 className="text-base font-semibold text-foreground">{t('whereTitle', { name: municipality.name })}</h2>
              <ul className="mt-3 space-y-1.5 text-sm text-muted-foreground">
                {seatLine && <li>{seatLine}</li>}
                {regionLine && <li>{regionLine}</li>}
                <li>{t('districtCount', { count: district.count, district: municipality.district })}</li>
                {mapHref && (
                  <li>
                    <a href={mapHref} target="_blank" rel="noopener noreferrer nofollow" className="font-medium text-primary hover:underline">
                      {t('mapLink')}
                    </a>
                  </li>
                )}
              </ul>
            </div>
            <div>
              <h2 className="text-base font-semibold text-foreground">{t('taxTitle')}</h2>
              <p className="mt-3 text-sm font-medium text-foreground">{getTaxOffice(municipality)}</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {municipality.country === 'CZ' ? t('taxNoteCz') : t('taxNoteSk')}
              </p>
              {socialOffice && (
                <>
                  <p className="mt-4 text-sm font-medium text-foreground">{socialOffice}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{t('socialNote')}</p>
                </>
              )}
              <p className="mt-4 text-sm text-muted-foreground">
                {municipality.country === 'CZ' ? t('healthNoteCz') : t('healthNoteSk')}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {municipality.country === 'CZ' ? t('tradeNoteCz') : t('tradeNoteSk')}
              </p>
            </div>
          </div>

          <div className="mt-10 max-w-2xl space-y-4 text-sm leading-relaxed text-muted-foreground">
            <p>{t('body')}</p>
            <p>{t('localNote', { district: municipality.district })}</p>
          </div>

          {nearby.length > 0 && (
            <div className="mt-10 max-w-3xl">
              <h2 className="text-base font-semibold text-foreground">{t('nearbyTitle')}</h2>
              <ul className="mt-3 flex flex-wrap gap-2">
                {nearby.map(({ municipality: n, km: d }) => (
                  <li key={n.slug}>
                    <Link
                      href={`/invoicing/${n.slug}`}
                      className="inline-block rounded-full border border-border px-3 py-1 text-sm text-foreground hover:border-primary hover:text-primary"
                    >
                      {n.name} <span className="text-muted-foreground">· {t('km', { km: km(d) })}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {district.others.length > 0 && (
            <div className="mt-8 max-w-3xl">
              <h2 className="text-base font-semibold text-foreground">
                {t('districtTitle', { district: municipality.district })}
              </h2>
              <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-sm">
                {district.others.map((n) => (
                  <li key={n.slug}>
                    <Link href={`/invoicing/${n.slug}`} className="text-muted-foreground hover:text-foreground hover:underline">
                      {n.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <Link
            href={regionHref}
            className="mt-10 inline-block text-sm font-medium text-primary hover:underline"
          >
            {t('browseCta', { region: municipality.region })}
          </Link>
        </section>
      </>
  );
}
