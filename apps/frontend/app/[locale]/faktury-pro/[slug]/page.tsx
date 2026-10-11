import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { routing } from '@/i18n/routing';
import { MarketingFooter } from '@/components/marketing-footer';
import { MarketingNavbar } from '@/components/marketing-navbar';
import { getBuildTimeMunicipalities, getMunicipalityBySlug, regionAnchorId } from '@/lib/municipalities';
import { SITE_URL } from '@/lib/site';

/**
 * Local-SEO landing page — one per real Czech/Slovak municipality. See
 * `apps/frontend/data/README.md` for the data source and
 * `apps/frontend/lib/municipalities.ts` for how the (small) build-time set
 * vs. the (much larger) on-demand set is decided.
 *
 * IMPORTANT (doorway-page risk — flagged to and accepted by the founder):
 * the actual product does not differ by municipality at all. Everything
 * below `<h1>` other than the municipality's real name/region/district is
 * the same templated copy on every one of the ~9,100 pages this route can
 * render. This page deliberately does NOT:
 *   - claim any town-specific customer count, testimonial, or usage stat
 *     (there is no such data, and inventing it would be a straightforwardly
 *     false claim to both users and Google);
 *   - emit LocalBusiness/postal-address structured data, since Faktur has
 *     no physical presence in any of these towns and that markup exists
 *     specifically to assert one;
 *   - pretend the product behaves differently here than anywhere else — the
 *     copy says so explicitly (`localNote`).
 * If Google's spam policies ever require pulling this route, everything
 * that makes that easy lives under this one `faktury-pro` segment plus
 * `data/municipalities.json` and `lib/municipalities.ts`.
 */

type Params = { locale: string; slug: string };

// Statically pre-render only the ~159 municipalities that are themselves a
// district/region seat (the largest, most-searched places, including both
// capitals). Every other municipality page (the vast majority of the
// ~9,100) is rendered on first request and then cached — see `revalidate`
// below. Building all ~9,100 municipalities × 3 locales (~27,000 pages) up
// front would make `next build` disproportionately slow for a route whose
// pages are intentionally near-identical templated shells, and it buys
// nothing for SEO purposes: an on-demand ISR page is served as the exact
// same fully-rendered HTML to Googlebot as a build-time one, just generated
// on first visit instead of at build time.
export function generateStaticParams() {
  return getBuildTimeMunicipalities().map((m) => ({ slug: m.slug }));
}

// Allow slugs outside the build-time set to be rendered on demand instead of
// 404ing.
export const dynamicParams = true;

// This route's content is static per municipality (no live data), so a long
// revalidation window is enough to pick up copy/template changes on
// redeploy without regenerating every page on every request.
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
  const title = t('heading', { name: municipality.name });
  const description = `${t('lead', { name: municipality.name })} ${t('localNote', { district: municipality.district })}`;

  const languages: Record<string, string> = {};
  for (const l of routing.locales) {
    languages[l] = `${SITE_URL}/${l}/faktury-pro/${slug}`;
  }
  languages['x-default'] = `${SITE_URL}/${routing.defaultLocale}/faktury-pro/${slug}`;

  return {
    title,
    description,
    alternates: {
      canonical: `${SITE_URL}/${locale}/faktury-pro/${slug}`,
      languages
    }
  };
}

export default async function MunicipalityPage({ params }: { params: Promise<Params> }) {
  const { slug } = await params;
  const municipality = getMunicipalityBySlug(slug);
  if (!municipality) {
    notFound();
  }

  const t = await getTranslations('municipalityPages');
  const countryLabel = municipality.country === 'CZ' ? t('countryCz') : t('countrySk');
  const regionHref = `/faktury-pro#${regionAnchorId(municipality.country, municipality.region)}`;

  return (
    <div className="flex min-h-screen flex-col">
      <MarketingNavbar />

      <main className="flex-1">
        <section className="container py-16 sm:py-24">
          <nav aria-label="Breadcrumb" className="text-sm text-muted-foreground">
            <Link href="/faktury-pro" className="hover:text-foreground">
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
              <dt className="text-muted-foreground">{t('breadcrumbBrowse')}</dt>
              <dd className="font-medium text-foreground">{countryLabel}</dd>
            </div>
          </dl>

          <Link
            href="/signup"
            className="mt-8 inline-flex items-center justify-center rounded-md bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground transition-colors hover:opacity-90"
          >
            {t('cta')}
          </Link>

          <div className="mt-14 max-w-2xl space-y-4 border-t border-border pt-8 text-sm leading-relaxed text-muted-foreground">
            <p>{t('body')}</p>
            <p>{t('localNote', { district: municipality.district })}</p>
          </div>

          <Link
            href={regionHref}
            className="mt-10 inline-block text-sm font-medium text-primary hover:underline"
          >
            {t('browseCta', { region: municipality.region })}
          </Link>
        </section>
      </main>

      <MarketingFooter />
    </div>
  );
}
