import type { MetadataRoute } from 'next';
import { sitemapShardUrls } from './sitemap';

/**
 * Every route lives under `/[locale]/...` (`localePrefix: 'always'`), so
 * each private section is disallowed under any locale prefix.
 *
 * Private: the signed-in app (route groups add no path segment, so these
 * are real top-level paths) and `/i/<token>` / `/c/<token>` — a client's private invoice or portal
 * link, which also carries `noindex`. The auth forms are deliberately NOT
 * disallowed: they are `noindex`, and a crawler has to be allowed to fetch
 * a page to see that.
 *
 * AI crawlers get their own group, as on VoxelRank (docs/seo-audit-2026-09
 * §1.1 there): clean content paths are open so the product can be cited,
 * query strings are closed. A crawler obeys only the most specific group
 * that matches it and inherits nothing from `*`, so the private paths are
 * repeated there.
 */
const PRIVATE = [
  'dashboard',
  'invoices',
  'expenses',
  'bank',
  'contacts',
  'reports',
  'settings',
  'billing',
  'time',
  'invite',
  'welcome',
  'i/',
  'c/',
  'unsubscribe/',
  // Counting redirects to partner sites (VoxelRank: /partners/go/).
  'partners/go/'
].map(
  (section) => `/*/${section}`
);

const AI_CRAWLERS = [
  'GPTBot',
  'OAI-SearchBot',
  'ClaudeBot',
  'Claude-SearchBot',
  'PerplexityBot',
  'Google-Extended',
  'Amazonbot',
  'CCBot',
  'meta-externalagent'
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: '*', allow: '/', disallow: ['/api/', ...PRIVATE] },
      { userAgent: AI_CRAWLERS, allow: '/', disallow: ['/api/', ...PRIVATE, '/*?'] },
      { userAgent: ['Bytespider', 'SemrushBot'], disallow: '/' }
    ],
    sitemap: sitemapShardUrls()
  };
}
