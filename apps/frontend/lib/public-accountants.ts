import { fetchAccountants, type ListingRegion, type PublicAccountant } from '@/lib/accountant-directory';
import type { Municipality } from '@/lib/municipalities';

/**
 * Approved accountant listings for a town page: the ones serving the town's
 * region (kraj). Listings carry regions, not towns, so this is as close as
 * the directory gets. Fails soft like `fetchAccountants`.
 */
const REGION_CODES: Record<string, ListingRegion> = {
  'Hlavní město Praha': 'CZ-10',
  Středočeský: 'CZ-20',
  Jihočeský: 'CZ-31',
  Plzeňský: 'CZ-32',
  Karlovarský: 'CZ-41',
  Ústecký: 'CZ-42',
  Liberecký: 'CZ-51',
  Královéhradecký: 'CZ-52',
  Pardubický: 'CZ-53',
  Vysočina: 'CZ-63',
  Jihomoravský: 'CZ-64',
  Olomoucký: 'CZ-71',
  Zlínský: 'CZ-72',
  Moravskoslezský: 'CZ-80',
  'Bratislavský kraj': 'SK-BL',
  'Trnavský kraj': 'SK-TA',
  'Trenčiansky kraj': 'SK-TC',
  'Nitriansky kraj': 'SK-NI',
  'Žilinský kraj': 'SK-ZI',
  'Banskobystrický kraj': 'SK-BC',
  'Prešovský kraj': 'SK-PV',
  'Košický kraj': 'SK-KI'
};

export function regionCode(m: Municipality): ListingRegion | undefined {
  return REGION_CODES[m.region];
}

/** "Jihomoravský kraj", "Kraj Vysočina", "Hlavní město Praha", "Trenčiansky kraj": the region's own name. */
export function regionLabel(m: Municipality): string {
  if (m.region === 'Vysočina') return 'Kraj Vysočina';
  return /kraj$|^Hlavní/.test(m.region) ? m.region : `${m.region} kraj`;
}

export async function accountantsForTown(m: Municipality, limit = 8): Promise<PublicAccountant[]> {
  const region = regionCode(m);
  if (!region) return [];
  return (await fetchAccountants({ region })).slice(0, limit);
}
