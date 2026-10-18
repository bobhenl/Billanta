const BACKEND_URL = (process.env.BACKEND_URL ?? 'http://localhost:3000').replace(/\/$/, '');

export const PARTNER_CATEGORIES = ['accounting', 'banking', 'software', 'service', 'other'] as const;
export type PartnerCategory = (typeof PARTNER_CATEGORIES)[number];

export interface PublicPartner {
  slug: string;
  name: string;
  description: string | null;
  logoUrl: string | null;
  category: PartnerCategory;
  featured: boolean;
}

/**
 * The footer's partner list is cached for a day, not five minutes. The
 * footer is on every public page, and a fetch's revalidate caps the ISR
 * window of the whole page: at 300 s the ~9,000 municipality pages (meant
 * to keep for 30 days) were re-rendered every five minutes a crawler came
 * by. A new footer partner showing up a day later is fine.
 */
const FOOTER_REVALIDATE = 86400;

/**
 * Active partners from the public backend endpoint, cached for five
 * minutes (a day for the footer list). An unreachable backend just means
 * no partners on the page (the marketing site must render without it).
 */
export async function fetchPartners(opts: { category?: PartnerCategory; footer?: boolean } = {}): Promise<PublicPartner[]> {
  const query = new URLSearchParams();
  if (opts.category) query.set('category', opts.category);
  if (opts.footer) query.set('footer', '1');
  try {
    const res = await fetch(`${BACKEND_URL}/api/v1/public/partners${query.size ? `?${query}` : ''}`, {
      next: { revalidate: opts.footer ? FOOTER_REVALIDATE : 300 },
      signal: AbortSignal.timeout(3000)
    });
    return res.ok ? ((await res.json()) as PublicPartner[]) : [];
  } catch {
    return [];
  }
}

/**
 * Every partner link goes through the counting redirect, never straight to
 * the partner. A plain `<a>` with the locale already in it: a next-intl
 * `<Link>` could prefetch the route handler and count clicks nobody made.
 */
export const partnerHref = (locale: string, slug: string) => `/${locale}/partners/go/${slug}`;
