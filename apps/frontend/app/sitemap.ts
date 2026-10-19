import type { MetadataRoute } from 'next';
import { routing } from '@/i18n/routing';
import { comparedPages } from '@/lib/competitors';
import { FEATURE_PAGES } from '@/lib/feature-pages';
import { CALCULATORS, GUIDES, GUIDES_HUB_LOCALES } from '@/lib/public-tools';
import { fetchBlogSitemap } from '@/lib/blog';
import { getAllMunicipalities, isIndexedMunicipality, municipalityLocale } from '@/lib/municipalities';
import { SITE_URL } from '@/lib/site';

import { fetchAccountants } from '@/lib/accountant-directory';

/**
 * Sitemap for the whole public site, sharded via Next's `generateSitemaps()`.
 *
 * Why sharded: `getAllMunicipalities()` has ~9,000 real, sourced entries
 * (see `apps/frontend/data/README.md`), each listed in its own language
 * only and for now only the larger towns (isIndexedMunicipality), plus
 * a handful of static marketing routes × 3 locales. That's well
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

const ACCOUNTANTS_PATH = '/accountants';

interface UrlEntry {
  path: string; // locale-less path, e.g. "/" or "/invoicing/valtice"
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
  { path: '/compare', changeFrequency: 'monthly', priority: 0.7 },
  ...comparedPages().map((b): UrlEntry => ({ path: `/compare/${b.key}`, changeFrequency: 'monthly', priority: 0.6, locales: b.locales })),
  // Czech towns in cs, Slovak in sk; the English directory is noindex.
  { path: '/invoicing', changeFrequency: 'weekly', priority: 0.8, locales: ['cs', 'sk'] },
  { path: '/features', changeFrequency: 'monthly', priority: 0.8 },
  { path: '/create-invoice', changeFrequency: 'monthly', priority: 0.9 },
  { path: '/demo', changeFrequency: 'monthly', priority: 0.9 },
  { path: '/your-first-invoice', changeFrequency: 'monthly', priority: 0.8 },
  { path: '/invoicing-for-beginners', changeFrequency: 'monthly', priority: 0.7 },
  { path: '/invoicing-for-advanced', changeFrequency: 'monthly', priority: 0.7 },
  { path: '/team-roles', changeFrequency: 'monthly', priority: 0.6 },
  { path: '/for-owners', changeFrequency: 'monthly', priority: 0.5 },
  { path: '/for-assistants', changeFrequency: 'monthly', priority: 0.5 },
  { path: '/for-accountants', changeFrequency: 'monthly', priority: 0.7 },
  { path: '/for-schools', changeFrequency: 'monthly', priority: 0.6 },
  { path: '/for-creators', changeFrequency: 'monthly', priority: 0.6 },
  { path: '/events', changeFrequency: 'monthly', priority: 0.5 },
  { path: '/partners', changeFrequency: 'weekly', priority: 0.5 },
  { path: '/for-partners', changeFrequency: 'monthly', priority: 0.6 },
  ...['courses', 'coworkings', 'communities', 'expats', 'banks'].map((s): UrlEntry => ({ path: `/for-${s}`, changeFrequency: 'monthly', priority: 0.6 })),
  // Dropped in sitemap() while no accountant is approved (see there).
  { path: ACCOUNTANTS_PATH, changeFrequency: 'weekly', priority: 0.6 },
  ...FEATURE_PAGES.map((f): UrlEntry => ({ path: `/features/${f.slug}`, changeFrequency: 'monthly', priority: 0.7 })),
  // Calculators and guides only in the languages they are published in
  // (lib/public-tools.ts); the sk copy of a Czech-rules page is noindex.
  { path: '/calculators', changeFrequency: 'monthly', priority: 0.7 },
  ...CALCULATORS.map((c): UrlEntry => ({ path: '/calculators/' + c.slug, changeFrequency: 'monthly', priority: 0.7, locales: c.locales })),
  { path: '/guides', changeFrequency: 'monthly', priority: 0.6, locales: GUIDES_HUB_LOCALES },
  ...GUIDES.map((g): UrlEntry => ({ path: '/guides/' + g.slug, changeFrequency: 'monthly', priority: 0.7, locales: g.locales }))
];

function buildAllEntries(): UrlEntry[] {
  // Only indexed municipality pages, each in its own language (see
  // isIndexedMunicipality); a noindex URL in a sitemap is a contradiction.
  const municipalityEntries: UrlEntry[] = getAllMunicipalities()
    .filter((m) => isIndexedMunicipality(m, municipalityLocale(m)))
    .map((m) => ({
      path: `/invoicing/${m.slug}`,
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
  let slice = flat.slice(start, start + URLS_PER_SHARD);
  // An empty accountant directory is a thin page: it stays crawlable and
  // linked, but is not nominated. Filtered after slicing, so the shard
  // boundaries stay the same whether or not it is listed.
  if (slice.some((e) => e.path === ACCOUNTANTS_PATH) && (await fetchAccountants()).length === 0) {
    slice = slice.filter((e) => e.path !== ACCOUNTANTS_PATH);
  }

  return [...slice.map(({ path, locale, locales, changeFrequency, priority }) => {
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
  }), ...(Number(id) === 0 ? await blogEntries() : [])];
}

/**
 * Blog posts come from the backend, so they ride on the first shard instead
 * of the synchronous count robots.txt uses. Translations of one post can
 * have different slugs; they are grouped by translation key for hreflang.
 */
async function blogEntries(): Promise<MetadataRoute.Sitemap> {
  const posts = await fetchBlogSitemap();
  if (!posts.length) return [];
  const groups = new Map<string, Record<string, string>>();
  for (const p of posts) {
    const languages = groups.get(p.translationKey) ?? {};
    languages[p.locale] = `${SITE_URL}/${p.locale}/blog/${p.slug}`;
    groups.set(p.translationKey, languages);
  }
  // The index is only indexable in a language that has a post (see blog/page.tsx).
  const indexLocales = routing.locales.filter((l) => posts.some((p) => p.locale === l));
  const index = Object.fromEntries(indexLocales.map((l) => [l, `${SITE_URL}/${l}/blog`]));
  return [
    ...indexLocales.map((l) => ({ url: index[l]!, changeFrequency: 'weekly' as const, priority: 0.6, alternates: { languages: index } })),
    ...posts.map((p) => ({
      url: `${SITE_URL}/${p.locale}/blog/${p.slug}`,
      lastModified: p.updatedAt,
      changeFrequency: 'monthly' as const,
      priority: 0.6,
      alternates: { languages: groups.get(p.translationKey)! }
    }))
  ];
}
