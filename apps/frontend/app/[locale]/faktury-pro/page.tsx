import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { routing } from '@/i18n/routing';
import { MarketingFooter } from '@/components/marketing-footer';
import { MarketingNavbar } from '@/components/marketing-navbar';
import { getAllMunicipalities, getRegionGroups, regionAnchorId } from '@/lib/municipalities';
import { SITE_URL } from '@/lib/site';

/**
 * Directory/browse page for the `/faktury-pro/[slug]` municipality landing
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

  const languages: Record<string, string> = {};
  for (const l of routing.locales) {
    languages[l] = `${SITE_URL}/${l}/faktury-pro`;
  }
  languages['x-default'] = `${SITE_URL}/${routing.defaultLocale}/faktury-pro`;

  return {
    title: t('indexTitle'),
    description: t('indexLead'),
    alternates: {
      canonical: `${SITE_URL}/${locale}/faktury-pro`,
      languages
    }
  };
}

export default async function MunicipalityIndexPage() {
  const t = await getTranslations('municipalityPages');
  const groups = getRegionGroups();
  const total = getAllMunicipalities().length;

  return (
    <div className="flex min-h-screen flex-col">
      <MarketingNavbar />

      <main className="flex-1">
        <section className="container py-16 sm:py-24">
          <h1 className="max-w-2xl text-3xl font-semibold tracking-tight sm:text-4xl">
            {t('indexTitle')}
          </h1>
          <p className="mt-4 max-w-2xl text-lg text-muted-foreground">{t('indexLead')}</p>
          <p className="mt-2 text-sm text-muted-foreground">{t('indexCoverageNote', { count: total })}</p>

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
                    {group.region} <span className="font-normal text-muted-foreground">— {countryLabel}</span>
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
                            href={`/faktury-pro/${m.slug}`}
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
      </main>

      <MarketingFooter />
    </div>
  );
}
