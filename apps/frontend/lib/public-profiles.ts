/**
 * Public company profile (`app/[locale]/p/[slug]`) — reads the backend's
 * unauthenticated `GET /api/v1/public/profiles/:slug`. Server-side only.
 */
const BACKEND_URL = (process.env.BACKEND_URL ?? 'http://localhost:3000').replace(/\/$/, '');

export interface PublicProfile {
  slug: string;
  companyName: string;
  legalName: string;
  ico: string | null;
  dic: string | null;
  address: { street: string | null; city: string | null; postalCode: string | null; country: string } | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  registryNote: string | null;
  hasLogo: boolean;
  tagline: string | null;
  about: string | null;
  services: { id: string | null; title: string; description: string | null; price: string | null; unitPrice: number | null; unit: string | null }[];
  contactCta: boolean;
  /** `enabled` only when the owner switched orders on and some service can be ordered. */
  orders?: { enabled: boolean; customItems: boolean; prepay: boolean; currency: 'CZK' | 'EUR' };
  /** "Kontaktovat" message form. */
  contactForm?: boolean;
  /** Set when the profile is listed in the business directory (trade key, municipality slug). */
  directory?: { trade: string; town: string } | null;
}

/** `null` for an unknown or unpublished slug. Cached briefly — the owner sees changes within a minute. */
export async function getPublicProfile(slug: string): Promise<PublicProfile | null> {
  const res = await fetch(`${BACKEND_URL}/api/v1/public/profiles/${encodeURIComponent(slug)}`, { next: { revalidate: 60 } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Public profile request failed: HTTP ${res.status}`);
  return (await res.json()) as PublicProfile;
}
