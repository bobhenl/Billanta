import type { MetadataRoute } from 'next';
import { routing } from '@/i18n/routing';
import { getAllMunicipalities } from '@/lib/municipalities';
import { SITE_URL } from '@/lib/site';

/**
 * Sitemap for the whole public site, sharded via Next's `generateSitemaps()`.
 *
 * Why sharded: `getAllMunicipalities()` has ~9,100 real, sourced entries
 * (see `apps/frontend/data/README.md`) × 3 locales ≈ 27,000 URLs for the
 * `/faktury-pro/[slug]` pages alone, plus a handful of static marketing
 * routes. That's comfortably under the sitemap protocol's hard cap of
 * 50,000 URLs (and 50MB) per file, so a single `sitemap.xml` would still be
 * spec-legal today — but it leaves very little headroom (the CZ dataset is
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
}

// Static, public, crawlable marketing routes. Deliberately excludes anything
// under (dashboard)/(auth's post-login areas)/settings/billing — those are
// gated by `app/robots.ts` and have no SEO value anyway.
const STATIC_ENTRIES: UrlEntry[] = [
  { path: '/', changeFrequency: 'monthly', priority: 1 },
  { path: '/about', changeFrequency: 'yearly', priority: 0.5 },
  { path: '/legal/terms', changeFrequency: 'yearly', priority: 0.3 },
  { path: '/legal/privacy', changeFrequency: 'yearly', priority: 0.3 },
  { path: '/faktury-pro', changeFrequency: 'weekly', priority: 0.8 },
  { path: '/signup', changeFrequency: 'monthly', priority: 0.6 }
];

function buildAllEntries(): UrlEntry[] {
  const municipalityEntries: UrlEntry[] = getAllMunicipalities().map((m) => ({
    path: `/faktury-pro/${m.slug}`,
    changeFrequency: 'monthly',
    priority: 0.5
  }));
  return [...STATIC_ENTRIES, ...municipalityEntries];
}

function totalUrlCount(): number {
  return buildAllEntries().length * routing.locales.length;
}

export async function generateSitemaps() {
  const shardCount = Math.max(1, Math.ceil(totalUrlCount() / URLS_PER_SHARD));
  return Array.from({ length: shardCount }, (_, id) => ({ id }));
}

export default async function sitemap({ id }: { id: number }): Promise<MetadataRoute.Sitemap> {
  // Flatten (entry × locale) in a stable, deterministic order so each shard
  // id always maps to the same slice across builds.
  const flat: { path: string; locale: string; changeFrequency: UrlEntry['changeFrequency']; priority: number }[] = [];
  for (const entry of buildAllEntries()) {
    for (const locale of routing.locales) {
      flat.push({ path: entry.path, locale, changeFrequency: entry.changeFrequency, priority: entry.priority });
    }
  }

  const start = id * URLS_PER_SHARD;
  const slice = flat.slice(start, start + URLS_PER_SHARD);

  return slice.map(({ path, locale, changeFrequency, priority }) => {
    const languages: Record<string, string> = {};
    for (const l of routing.locales) {
      languages[l] = `${SITE_URL}/${l}${path}`;
    }
    languages['x-default'] = `${SITE_URL}/${routing.defaultLocale}${path}`;

    return {
      url: `${SITE_URL}/${locale}${path}`,
      changeFrequency,
      priority,
      alternates: { languages }
    };
  });
}
