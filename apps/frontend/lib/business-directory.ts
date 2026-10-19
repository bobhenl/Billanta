// Server-side only: it reads the municipality dataset (too big for a client bundle).
import { getAllMunicipalities, getMunicipalityBySlug, type Municipality } from '@/lib/municipalities';
import type { DirectoryTrade } from '@/lib/business-presets';

const BACKEND_URL = (process.env.BACKEND_URL ?? 'http://localhost:3000').replace(/\/$/, '');

/** One opted-in public profile, as GET /api/v1/public/directory returns it (backend src/public-profiles/directory.ts). */
export interface DirectoryListing {
  slug: string;
  name: string;
  tagline: string | null;
  trade: DirectoryTrade;
  /** Municipality slug (data/municipalities.json), picked by the owner from the company address. */
  town: string;
  /** The address city, only when the profile shows the address. */
  city: string | null;
  country: string;
  hasLogo: boolean;
}

/** A directory page with fewer listings than this is thin: crawlable and linked, but noindex and out of the sitemap. */
export const MIN_INDEXED_LISTINGS = 2;

export const isThin = (listings: readonly unknown[]) => listings.length < MIN_INDEXED_LISTINGS;

/**
 * Every listed profile, fetched once (one cached URL for all directory and
 * town pages) and filtered here. Five minutes of cache, so a withdrawn
 * listing disappears within minutes. An unreachable backend means an empty
 * directory, never an error page. Listings whose town is not a known
 * municipality are dropped: they would have no page to belong to.
 */
export async function fetchDirectory(): Promise<DirectoryListing[]> {
  try {
    const res = await fetch(`${BACKEND_URL}/api/v1/public/directory`, { next: { revalidate: 300 }, signal: AbortSignal.timeout(3000) });
    if (!res.ok) return [];
    const rows = (await res.json()) as DirectoryListing[];
    return Array.isArray(rows) ? rows.filter((l) => getMunicipalityBySlug(l.town)) : [];
  } catch {
    return [];
  }
}

export async function listingsForTown(m: Municipality): Promise<DirectoryListing[]> {
  return (await fetchDirectory()).filter((l) => l.town === m.slug);
}

/** Towns with at least one listing, most listings first, with the counts. */
export function townsOf(listings: readonly DirectoryListing[]): { municipality: Municipality; count: number }[] {
  const counts = new Map<string, number>();
  for (const l of listings) counts.set(l.town, (counts.get(l.town) ?? 0) + 1);
  return [...counts]
    .map(([slug, count]) => ({ municipality: getMunicipalityBySlug(slug)!, count }))
    .filter((t) => t.municipality)
    .sort((a, b) => b.count - a.count || a.municipality.name.localeCompare(b.municipality.name, 'cs'));
}

export const logoUrl = (l: Pick<DirectoryListing, 'slug'>) => `/api/public/profiles/${l.slug}/logo`;

const ascii = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Municipalities the company address can mean, for the town picker in the
 * settings: the exact name first ("Frýdek-Místek"), then without a district
 * number ("Praha 5") or a city part ("Brno-střed", "Bratislava - Staré
 * Mesto"). Several hits are towns of the same name; the owner picks one by
 * district. Only in the company's country.
 */
export function townCandidates(city: string | null | undefined, country: string | null | undefined): { slug: string; name: string; district: string }[] {
  if (!city?.trim()) return [];
  const pool = getAllMunicipalities().filter((m) => !country || m.country === country);
  const full = ascii(city);
  const tries = [full, full.replace(/\s*\d+$/, ''), full.split(/\s*-\s*/)[0]!.replace(/\s*\d+$/, '')];
  for (const name of tries) {
    if (!name) continue;
    const hits = pool.filter((m) => ascii(m.nameAscii) === name);
    if (hits.length) return hits.map((m) => ({ slug: m.slug, name: m.name, district: m.district }));
  }
  return [];
}
