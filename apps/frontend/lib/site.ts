/**
 * Canonical public origin for this app, used for absolute URLs in
 * `<link rel="canonical">`, hreflang alternates, `app/sitemap.ts`, and
 * `app/robots.ts`. No production domain has been decided/purchased yet
 * (nothing else in this scaffold sets one either — see the `/login`,
 * `/pricing` TODO placeholders in `components/marketing-navbar.tsx`), so
 * this falls back to a clearly-placeholder domain. Set `NEXT_PUBLIC_SITE_URL`
 * per environment — see `.env.example`.
 */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://billanta.com').replace(/\/$/, '');

/**
 * The product name, chosen for being globally unique and searchable
 * (".com/.cz/.sk/.eu/.app" all unregistered at the time of choosing, and no
 * existing product ranking for it) rather than a generic word like
 * "faktura". Use this constant in non-translated contexts (JSON-LD, robots,
 * sitemap, manifest); inside translated UI use the `app.name` message key.
 */
export const SITE_NAME = 'Billanta';

/**
 * Optional wildcard domain for public company profiles: with
 * `NEXT_PUBLIC_PROFILE_DOMAIN=billanta.com` (and a `*.billanta.com` DNS
 * record + certificate), `novak.billanta.com` serves `/p/novak` — see
 * `middleware.ts`. Unset, profiles live only at `/<locale>/p/<slug>`.
 */
export const PROFILE_DOMAIN = (process.env.NEXT_PUBLIC_PROFILE_DOMAIN ?? '').trim().toLowerCase().replace(/^\.+|\/+$/g, '');

/** The shareable address of a published profile. */
export function profileUrl(slug: string, locale = 'cs', origin = SITE_URL): string {
  return PROFILE_DOMAIN ? `https://${slug}.${PROFILE_DOMAIN}` : `${origin}/${locale}/p/${slug}`;
}
