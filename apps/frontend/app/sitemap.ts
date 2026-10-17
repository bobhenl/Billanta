import type { MetadataRoute } from 'next';
import { routing } from '@/i18n/routing';
import { FEATURE_PAGES } from '@/lib/feature-pages';
import { CALCULATORS, GUIDES, GUIDES_HUB_LOCALES } from '@/lib/public-tools';
import { getAllMunicipalities, municipalityLocale } from '@/lib/municipalities';
import { SITE_URL } from '@/lib/site';

/**
 * Sitemap for the whole public site, sharded via Next's `generateSitemaps()`.
 *
 * Why sharded: `getAllMunicipalities()` has ~9,000 real, sourced entries
 * (see `apps/frontend/data/README.md`), each listed in its own language
 * only, plus a handful of static marketing routes × 3 locales. That's well
 * under the sitemap protocol's hard cap of 50,000 URLs (and 50MB) per file,
 * so a single `sitemap.xml` would be spec-legal — but sharding keeps
 * headroom (the CZ dataset is
 * already known to be short ~107 municipalities that could be added later,
 * see the data README, and adding a 4th locale or any other section of the
 * site would push it over). Sharding now with a conservative per-file size
 * avoids a future surprise rewrite and matches Google's own guidance to
 * prefer several smaller sitemap files over one huge one for large sites.
 */

const URLS_PER_SHARD = 2000;

interface UrlEntry {
  path: string; // locale-less path, e.g. "/" or "/faktury-pro/valtice"
  changeFrequency: MetadataRoute.Sitemap[number]['changeFrequency'];
  priority: number;
  /** Only these locales (default: all). A municipality page is indexed in its own language only. */
  locales?: readonly string[];
}

// Static, public, crawlable marketing routes. Only pages that are themselves
// indexable belong here — the auth forms carry `noindex` (see
// (auth)/layout.tsx), and a sitemap URL that says noindex is a contradiction
// Search Console reports. Deliberately excludes anything
// under (dashboard)/(auth's post-login areas)/settings/billing — those are
// gated by `app/robots.ts` and have no SEO value anyway.
const STATIC_ENTRIES: UrlEntry[] = [
  { path: '/', changeFrequency: 'monthly', priority: 1 },
  { path: '/about', changeFrequency: 'yearly', priority: 0.5 },
  { path: '/legal/terms', changeFrequency: 'yearly', priority: 0.3 },
  { path: '/legal/privacy', changeFrequency: 'yearly', priority: 0.3 },
  { path: '/legal/dpa', changeFrequency: 'yearly', priority: 0.2 },
  { path: '/legal/cookies', changeFrequency: 'yearly', priority: 0.2 },
  { path: '/pricing', changeFrequency: 'monthly', priority: 0.8 },
  { path: '/srovnani', changeFrequency: 'monthly', priority: 0.7 },
  // Czech towns in cs, Slovak in sk; the English directory is noindex.
  { path: '/faktury-pro', changeFrequency: 'weekly', priority: 0.8, locales: ['cs', 'sk'] },
  { path: '/funkce', changeFrequency: 'monthly', priority: 0.8 },
  { path: '/vytvorit-fakturu', changeFrequency: 'monthly', priority: 0.9 },
  ...FEATURE_PAGES.map((f): UrlEntry => ({ path: `/funkce/${f.slug}`, changeFrequency: 'monthly', priority: 0.7 })),
  // Calculators and guides only in the languages they are published in
  // (lib/public-tools.ts); the sk copy of a Czech-rules page is noindex.
  { path: '/kalkulacky', changeFrequency: 'monthly', priority: 0.7 },
  ...CALCULATORS.map((c): UrlEntry => ({ path: '/kalkulacky/' + c.slug, changeFrequency: 'monthly', priority: 0.7, locales: c.locales })),
  { path: '/navody', changeFrequency: 'monthly', priority: 0.6, locales: GUIDES_HUB_LOCALES },
  ...GUIDES.map((g): UrlEntry => ({ path: '/navody/' + g.slug, changeFrequency: 'monthly', priority: 0.7, locales: g.locales }))
];

function buildAllEntries(): UrlEntry[] {
  // Each municipality only in its own language (see isIndexedMunicipality);
  // the other copies are noindex and a noindex URL in a sitemap is a contradiction.
  const municipalityEntries: UrlEntry[] = getAllMunicipalities().map((m) => ({
    path: `/faktury-pro/${m.slug}`,
    changeFrequency: 'monthly',
    priority: 0.5,
    locales: [municipalityLocale(m)]
  }));
  return [...STATIC_ENTRIES, ...municipalityEntries];
}

function totalUrlCount(): number {
  return buildAllEntries().reduce((sum, e) => sum + (e.locales ?? routing.locales).length, 0);
}

export function sitemapShardCount(): number {
  return Math.max(1, Math.ceil(totalUrlCount() / URLS_PER_SHARD));
}

/**
 * Next 15 serves each shard at `/sitemap/<id>.xml` and emits no index file
 * at `/sitemap.xml` itself, so `robots.ts` lists every shard URL directly
 * (multiple `Sitemap:` lines are valid robots.txt).
 */
export function sitemapShardUrls(): string[] {
  return Array.from({ length: sitemapShardCount() }, (_, id) => `${SITE_URL}/sitemap/${id}.xml`);
}

export async function generateSitemaps() {
  return Array.from({ length: sitemapShardCount() }, (_, id) => ({ id }));
}

export default async function sitemap({ id }: { id: number }): Promise<MetadataRoute.Sitemap> {
  // Flatten (entry × locale) in a stable, deterministic order so each shard
  // id always maps to the same slice across builds.
  const flat: { path: string; locale: string; locales: readonly string[]; changeFrequency: UrlEntry['changeFrequency']; priority: number }[] = [];
  for (const entry of buildAllEntries()) {
    const locales = entry.locales ?? routing.locales;
    for (const locale of locales) {
      flat.push({ path: entry.path, locale, locales, changeFrequency: entry.changeFrequency, priority: entry.priority });
    }
  }

  const start = id * URLS_PER_SHARD;
  const slice = flat.slice(start, start + URLS_PER_SHARD);

  return slice.map(({ path, locale, locales, changeFrequency, priority }) => {
    const languages: Record<string, string> = {};
    for (const l of locales) {
      languages[l] = `${SITE_URL}/${l}${path}`;
    }
    languages['x-default'] = `${SITE_URL}/${locales.includes(routing.defaultLocale) ? routing.defaultLocale : locales[0]}${path}`;

    return {
      url: `${SITE_URL}/${locale}${path}`,
      changeFrequency,
      priority,
      alternates: { languages }
    };
  });
}
