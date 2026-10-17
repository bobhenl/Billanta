const BACKEND_URL = (process.env.BACKEND_URL ?? 'http://localhost:3000').replace(/\/$/, '');

// Same codes as apps/backend/src/accountant-directory/listing.ts.
export const LISTING_REGIONS = [
  'CZ-10', 'CZ-20', 'CZ-31', 'CZ-32', 'CZ-41', 'CZ-42', 'CZ-51', 'CZ-52', 'CZ-53', 'CZ-63', 'CZ-64', 'CZ-71', 'CZ-72', 'CZ-80',
  'SK-BL', 'SK-TA', 'SK-TC', 'SK-NI', 'SK-ZI', 'SK-BC', 'SK-PV', 'SK-KI'
] as const;
export const LISTING_SERVICES = ['bookkeeping', 'tax_records', 'tax_return', 'vat', 'payroll', 'annual_accounts', 'advisory', 'startup'] as const;
export const LISTING_LANGUAGES = ['cs', 'sk', 'en', 'de', 'uk', 'pl', 'ru', 'vi'] as const;

export type ListingRegion = (typeof LISTING_REGIONS)[number];
export type ListingService = (typeof LISTING_SERVICES)[number];

export interface PublicAccountant {
  id: string;
  name: string;
  bio: string | null;
  regions: ListingRegion[];
  remote: boolean;
  services: ListingService[];
  languages: string[];
  priceHint: string | null;
  contactEmail: string | null;
  website: string | null;
  profileSlug: string | null;
}

export const isRegion = (v: string | undefined): v is ListingRegion => (LISTING_REGIONS as readonly string[]).includes(v ?? '');
export const isService = (v: string | undefined): v is ListingService => (LISTING_SERVICES as readonly string[]).includes(v ?? '');

/**
 * Approved listings from the public endpoint, cached for five minutes. An
 * unreachable backend means an empty list, never an error page.
 */
export async function fetchAccountants(filter: { region?: ListingRegion; service?: ListingService } = {}): Promise<PublicAccountant[]> {
  const query = new URLSearchParams();
  if (filter.region) query.set('region', filter.region);
  if (filter.service) query.set('service', filter.service);
  try {
    const res = await fetch(`${BACKEND_URL}/api/v1/public/accountants${query.size ? `?${query}` : ''}`, {
      next: { revalidate: 300 },
      signal: AbortSignal.timeout(3000)
    });
    return res.ok ? ((await res.json()) as PublicAccountant[]) : [];
  } catch {
    return [];
  }
}
