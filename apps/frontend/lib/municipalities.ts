import municipalitiesData from '@/data/municipalities.json';

/**
 * Backs the `/faktury-pro/[slug]` local-SEO landing pages (one per Czech and
 * Slovak municipality). See `apps/frontend/data/README.md` for exactly where
 * this data comes from, its real coverage, and its known gaps — every
 * municipality here is a real, sourced place; none were invented to pad out
 * the count.
 */
export interface Municipality {
  /** Unique across the whole dataset (both countries) — used as the route param. */
  slug: string;
  /** Official name, with diacritics. */
  name: string;
  /** `name` with diacritics stripped, for search/matching. */
  nameAscii: string;
  /** Region (kraj), human-readable. */
  region: string;
  /** District (okres), human-readable. */
  district: string;
  country: 'CZ' | 'SK';
  lat: number | null;
  lon: number | null;
}

const ALL_MUNICIPALITIES = municipalitiesData as Municipality[];

const BY_SLUG: ReadonlyMap<string, Municipality> = new Map(
  ALL_MUNICIPALITIES.map((m) => [m.slug, m])
);

export function getAllMunicipalities(): readonly Municipality[] {
  return ALL_MUNICIPALITIES;
}

export function getMunicipalityBySlug(slug: string): Municipality | undefined {
  return BY_SLUG.get(slug);
}

export function getMunicipalitiesByCountry(country: Municipality['country']): Municipality[] {
  return ALL_MUNICIPALITIES.filter((m) => m.country === country);
}

export interface RegionGroup {
  region: string;
  country: Municipality['country'];
  municipalities: Municipality[];
}

function stripDiacritics(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** Stable anchor id for a region's section on the `/faktury-pro` browse page. */
export function regionAnchorId(country: Municipality['country'], region: string): string {
  const ascii = stripDiacritics(region).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return `${country.toLowerCase()}-${ascii}`;
}

/**
 * Groups every municipality by (country, region) for the `/faktury-pro`
 * directory/browse page — real internal linking down to every municipality
 * page, not just a sitemap entry, per the project's doorway-page mitigation
 * plan (crawlable hierarchy: country -> region -> municipality).
 */
export function getRegionGroups(): RegionGroup[] {
  const groups = new Map<string, RegionGroup>();

  for (const m of ALL_MUNICIPALITIES) {
    const key = `${m.country}|${m.region}`;
    let group = groups.get(key);
    if (!group) {
      group = { region: m.region, country: m.country, municipalities: [] };
      groups.set(key, group);
    }
    group.municipalities.push(m);
  }

  for (const group of groups.values()) {
    group.municipalities.sort((a, b) => a.name.localeCompare(b.name, 'cs'));
  }

  return [...groups.values()].sort((a, b) => {
    if (a.country !== b.country) return a.country.localeCompare(b.country);
    return a.region.localeCompare(b.region, 'cs');
  });
}

/**
 * The subset of municipalities statically pre-rendered at build time (see
 * `app/[locale]/faktury-pro/[slug]/page.tsx` for why: build-time generation
 * of all ~9,100 municipalities × 3 locales is not reasonable). These are the
 * municipalities that are themselves the seat of their own district (i.e.
 * their name matches their `district` field) — the largest, most-searched
 * towns in the dataset, including both national capitals. Every other
 * municipality is rendered on first request and cached via ISR.
 */
export function getBuildTimeMunicipalities(): Municipality[] {
  return ALL_MUNICIPALITIES.filter((m) => m.name === m.district);
}
