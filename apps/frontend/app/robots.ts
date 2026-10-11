import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/site';

/**
 * Every route lives under `/[locale]/...` (see `i18n/routing.ts`,
 * `localePrefix: 'always'`), so each disallowed section needs a leading
 * locale wildcard segment to match under every locale prefix.
 *
 * Disallowed: the signed-in dashboard app — `(dashboard)/dashboard`,
 * `/invoices`, `/contacts`, `/settings`, `/billing` (route groups like
 * `(dashboard)` don't add a path segment, so these are real top-level
 * paths). There is no auth guard on these routes yet (see
 * apps/frontend/README.md), but they have no SEO value and shouldn't be
 * indexed regardless. There is no `/api` route in this Next.js app as of
 * this writing (the backend API is a separate service) — if one is added
 * later under `app`, it should be added here too.
 *
 * Allowed explicitly: `/faktury-pro` and everything under it — the whole
 * point of this route is to be crawled and indexed.
 */
const DISALLOWED_SECTIONS = ['dashboard', 'invoices', 'contacts', 'settings', 'billing'];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: ['/', '/faktury-pro', '/faktury-pro/*'],
      disallow: DISALLOWED_SECTIONS.map((section) => `/*/${section}`)
    },
    sitemap: `${SITE_URL}/sitemap.xml`
  };
}
