/**
 * "Odběratel si doplní údaje sám": the public page `/d/:token` reads the
 * draft it belongs to from `GET /api/v1/public/buyer-details/:token`
 * (no session; the backend only answers for an open request on a draft).
 */
const BACKEND_URL = (process.env.BACKEND_URL ?? 'http://localhost:3000').replace(/\/$/, '');

/** A link token: 12 base62 characters, or a UUID for links sent before the short ones. */
export const isBuyerDetailsToken = (token: string) => /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9A-Za-z]{12})$/i.test(token);

/** Fields the supplier can make mandatory (name and address always are). */
export type BuyerDetailsField = 'email' | 'phone' | 'ico' | 'dic';

export interface BuyerDetailsView {
  documentType: string;
  currency: string;
  language: string;
  dueDate: string | null;
  supplier: { name: string; ico: string | null; dic: string | null; street: string | null; city: string | null; postalCode: string | null; country: string };
  items: { description: string; quantity: number; unit: string | null; unitPrice: number; vatRate: number | null; total: number }[];
  totals: { withoutVat: number; vat: number; total: number };
  submitted: boolean;
  prefill: { name: string | null; email: string | null; country: string | null; isPerson: boolean };
  required: BuyerDetailsField[];
  /** The supplier's IČO is in ARES/RPO under the same name. */
  supplierVerified: boolean;
}

export async function getBuyerDetailsView(token: string, ip: string): Promise<BuyerDetailsView | null> {
  if (!isBuyerDetailsToken(token)) return null;
  try {
    const res = await fetch(`${BACKEND_URL}/api/v1/public/buyer-details/${encodeURIComponent(token)}`, {
      headers: ip ? { 'x-guest-ip': ip } : {},
      cache: 'no-store',
      signal: AbortSignal.timeout(8000)
    });
    if (!res.ok) return null;
    return (await res.json()) as BuyerDetailsView;
  } catch {
    return null;
  }
}
