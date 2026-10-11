/**
 * Canonical public origin for this app, used for absolute URLs in
 * `<link rel="canonical">`, hreflang alternates, `app/sitemap.ts`, and
 * `app/robots.ts`. No production domain has been decided/purchased yet
 * (nothing else in this scaffold sets one either — see the `/login`,
 * `/pricing` TODO placeholders in `components/marketing-navbar.tsx`), so
 * this falls back to a clearly-placeholder domain. Set `NEXT_PUBLIC_SITE_URL`
 * once a real domain exists — see `.env.example`.
 */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://faktur.app').replace(/\/$/, '');

/**
 * PROVISIONAL PLACEHOLDER — the founder has said this name will likely
 * change before launch. This constant exists so that renaming later is a
 * one-place change: use it (or the `app.name` i18n key, which should itself
 * be sourced from the same decision once one is made) for every
 * user-facing mention of the product name in non-translated contexts
 * (e.g. JSON-LD/structured data, `<meta>` tags outside next-intl,
 * non-locale routes like `app/sitemap.ts`/`app/robots.ts`). Inside
 * translated UI, prefer the `app.name` message key instead — see the
 * comment on its first usage in `app/[locale]/layout.tsx`. Never hardcode
 * the literal string "Faktur" elsewhere.
 */
export const SITE_NAME = 'Faktur';
