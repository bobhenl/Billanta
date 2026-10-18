import municipalitiesData from '@/data/municipalities.json';

/**
 * Backs the `/invoicing/[slug]` local-SEO landing pages (one per Czech and
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
  /** Inhabitants (ČSÚ 1 Jan 2025 / ŠÚ SR 30 Jun 2025), null when the official row couldn't be matched. */
  population: number | null;
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

/** Stable anchor id for a region's section on the `/invoicing` browse page. */
export function regionAnchorId(country: Municipality['country'], region: string): string {
  const ascii = stripDiacritics(region).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return `${country.toLowerCase()}-${ascii}`;
}

/**
 * Groups every municipality by (country, region) for the `/invoicing`
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
 * `app/[locale]/invoicing/[slug]/page.tsx` for why: build-time generation
 * of all ~9,100 municipalities × 3 locales is not reasonable). These are the
 * municipalities that are themselves the seat of their own district (i.e.
 * their name matches their `district` field) — the largest, most-searched
 * towns in the dataset, including both national capitals. Every other
 * municipality is rendered on first request and cached via ISR.
 */
export function getBuildTimeMunicipalities(): Municipality[] {
  return ALL_MUNICIPALITIES.filter(isDistrictSeat);
}

/** Seat of its own district: the name matches the district, or it is the city of a "…-město" district (Brno, Ostrava, Plzeň). */
export function isDistrictSeat(m: Municipality): boolean {
  return m.name === m.district || m.district === `${m.name}-město`;
}

/** The one locale a municipality's page is written for: Czech places in `cs`, Slovak ones in `sk`. */
export function municipalityLocale(m: Municipality): 'cs' | 'sk' {
  return m.country === 'CZ' ? 'cs' : 'sk';
}

/** Towns of this size and up are "major": listed first and offered as nearby towns. */
const MAJOR_POPULATION = 10_000;

/** A district seat or a town of MAJOR_POPULATION and up. */
export function isMajorMunicipality(m: Municipality): boolean {
  return isDistrictSeat(m) || (m.population ?? 0) >= MAJOR_POPULATION;
}

/**
 * Smallest population whose page search engines get, from
 * `MUNICIPALITY_INDEX_MIN_POPULATION` (default 10,000, ~200 towns; 0 = all).
 * While the site is new, a couple of hundred solid pages earn crawl budget
 * and trust faster than 9,000 thin ones; lower it step by step as they get
 * indexed. The sitemap and robots meta follow.
 */
const INDEX_MIN_POPULATION = (() => {
  const n = Number.parseInt(process.env.MUNICIPALITY_INDEX_MIN_POPULATION ?? '', 10);
  return Number.isFinite(n) && n >= 0 ? n : 10_000;
})();

/**
 * Whether `/{locale}/invoicing/{slug}` is offered to search engines
 * (sitemap + `index`). Only in the municipality's own language: a Czech
 * village has no audience in Slovak or English, and three language copies
 * of the same town page are exactly the near-duplicates that read as
 * doorway pages. Smaller places and the other locales stay reachable and
 * `follow`, but `noindex`. Each indexed page carries data no other page has
 * (nearest places with distances, position against the district and region
 * seat, the competent tax office) — see the [slug] page.
 */
export function isIndexedMunicipality(m: Municipality, locale: string): boolean {
  return locale === municipalityLocale(m) && (INDEX_MIN_POPULATION === 0 || (m.population ?? 0) >= INDEX_MIN_POPULATION);
}

/** The district's seat, when `m` is not one itself. */
export function getDistrictSeat(m: Municipality): Municipality | undefined {
  if (isDistrictSeat(m)) return undefined;
  return ALL_MUNICIPALITIES.find((o) => o.country === m.country && o.district === m.district && isDistrictSeat(o));
}

/** Region (kraj) -> its seat. České Budějovice is a known gap in the data, so Jihočeský has none. */
const REGION_SEATS: Record<string, string> = {
  'Hlavní město Praha': 'Praha',
  Středočeský: 'Praha',
  Jihomoravský: 'Brno',
  Moravskoslezský: 'Ostrava',
  Plzeňský: 'Plzeň',
  Královéhradecký: 'Hradec Králové',
  Pardubický: 'Pardubice',
  Liberecký: 'Liberec',
  Ústecký: 'Ústí nad Labem',
  Karlovarský: 'Karlovy Vary',
  Vysočina: 'Jihlava',
  Olomoucký: 'Olomouc',
  Zlínský: 'Zlín',
  'Bratislavský kraj': 'Bratislava',
  'Trnavský kraj': 'Trnava',
  'Trenčiansky kraj': 'Trenčín',
  'Nitriansky kraj': 'Nitra',
  'Žilinský kraj': 'Žilina',
  'Banskobystrický kraj': 'Banská Bystrica',
  'Prešovský kraj': 'Prešov',
  'Košický kraj': 'Košice'
};

/** The regional seat (krajské město); for Středočeský kraj that is Praha. */
export function getRegionSeat(m: Municipality): Municipality | undefined {
  const name = REGION_SEATS[m.region];
  if (!name) return undefined;
  return ALL_MUNICIPALITIES.find((o) => o.country === m.country && o.name === name && isDistrictSeat(o))
    ?? ALL_MUNICIPALITIES.find((o) => o.country === m.country && o.name === name);
}

/**
 * The tax office that administers income tax and VAT for a sole trader
 * living here (or a company seated here). Both countries organise them by
 * region: CZ has one "Finanční úřad pro … kraj" per kraj, SK one
 * "Daňový úrad" per regional seat. Official names, so not translated.
 */
export function getTaxOffice(m: Municipality): string {
  if (m.country === 'SK') {
    const seat = REGION_SEATS[m.region];
    return seat ? `Daňový úrad ${seat}` : 'Daňový úrad';
  }
  if (m.region === 'Hlavní město Praha') return 'Finanční úřad pro hlavní město Prahu';
  if (m.region === 'Vysočina') return 'Finanční úřad pro Kraj Vysočina';
  return `Finanční úřad pro ${m.region} kraj`;
}

/**
 * The social security office (OSSZ) an OSVČ in this Czech municipality
 * reports to. There is one per okres, named after it, with these
 * exceptions: Prague has PSSZ, Brno-město has MSSZ Brno, and the three
 * Plzeň okresy share OSSZ Plzeň. Checked against the ČSSZ contact list
 * (https://www.cssz.gov.cz/web/cz/kontakty, by kraj) in October 2026.
 * Slovakia: null, Sociálna poisťovňa branches do not map 1:1 to okresy.
 */
export function getSocialSecurityOffice(m: Municipality): string | null {
  if (m.country !== 'CZ' || !m.district) return null;
  if (m.district === 'Praha') return 'Pražská správa sociálního zabezpečení';
  if (m.district === 'Brno-město') return 'Městská správa sociálního zabezpečení Brno';
  if (m.district.startsWith('Plzeň-')) return 'Okresní správa sociálního zabezpečení Plzeň';
  if (m.district === 'Ostrava-město') return 'Okresní správa sociálního zabezpečení Ostrava';
  return `Okresní správa sociálního zabezpečení ${m.district}`;
}

/** Great-circle distance in km, or null without coordinates. */
export function distanceKm(a: Municipality, b: Municipality): number | null {
  if (a.lat == null || a.lon == null || b.lat == null || b.lon == null) return null;
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

export type Direction = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';

/** Which way `to` lies from `from`, in eight compass points. */
export function direction(from: Municipality, to: Municipality): Direction | null {
  if (from.lat == null || from.lon == null || to.lat == null || to.lon == null) return null;
  const dy = to.lat - from.lat;
  const dx = (to.lon - from.lon) * Math.cos((from.lat * Math.PI) / 180);
  const deg = ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
  return (['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'] as const)[Math.round(deg / 45) % 8]!;
}

export interface NearbyMunicipality {
  municipality: Municipality;
  km: number;
}

/** Nearest places in the same country regardless of district borders, closest first. */
export function getNearbyMunicipalities(m: Municipality, limit = 10): NearbyMunicipality[] {
  const out: NearbyMunicipality[] = [];
  for (const o of ALL_MUNICIPALITIES) {
    if (o.country !== m.country || o.slug === m.slug) continue;
    const km = distanceKm(m, o);
    if (km != null) out.push({ municipality: o, km });
  }
  return out.sort((a, b) => a.km - b.km).slice(0, limit);
}

/** The nearest other major towns (see isMajorMunicipality), closest first. */
export function getNearbyMajorMunicipalities(m: Municipality, limit = 6): NearbyMunicipality[] {
  const out: NearbyMunicipality[] = [];
  for (const o of ALL_MUNICIPALITIES) {
    if (o.country !== m.country || o.slug === m.slug || !isMajorMunicipality(o)) continue;
    const km = distanceKm(m, o);
    if (km != null) out.push({ municipality: o, km });
  }
  return out.sort((a, b) => a.km - b.km).slice(0, limit);
}

/**
 * Other municipalities in the same district (minus `exclude`), alphabetically,
 * plus the district size.
 */
export function getDistrictNeighbours(
  m: Municipality,
  exclude: ReadonlySet<string> = new Set(),
  limit = 24
): { count: number; others: Municipality[] } {
  const same = ALL_MUNICIPALITIES.filter((o) => o.country === m.country && o.district === m.district && o.slug !== m.slug);
  const others = same
    .filter((o) => !exclude.has(o.slug))
    .sort((a, b) => Number(isDistrictSeat(b)) - Number(isDistrictSeat(a)) || a.name.localeCompare(b.name, 'cs'))
    .slice(0, limit);
  return { count: same.length + 1, others };
}
