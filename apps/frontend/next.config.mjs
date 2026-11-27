import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import createNextIntlPlugin from 'next-intl/plugin';

// The public site used Czech slugs before it went English. Old links and
// indexed pages keep working through permanent redirects.
const legacy = JSON.parse(readFileSync(new URL('./lib/legacy-slugs.json', import.meta.url), 'utf8'));

function legacyRedirects() {
  const out = [];
  // Same list as i18n/locales.ts (this file can't import TypeScript).
  for (const prefix of ['/:locale(cs|sk|en|de|pl|uk|hu|ro|fr|es|it|nl|pt)', '']) {
    const to = prefix ? '/:locale' : '';
    for (const [from, slug] of Object.entries(legacy.features)) {
      out.push({ source: `${prefix}/funkce/${from}`, destination: `${to}/features/${slug}`, permanent: true });
    }
    for (const [from, segment] of Object.entries(legacy.segments)) {
      out.push({ source: `${prefix}/${from}`, destination: `${to}/${segment}`, permanent: true });
      out.push({ source: `${prefix}/${from}/:path*`, destination: `${to}/${segment}/:path*`, permanent: true });
    }
  }
  return out;
}

// Points at the request-config module that resolves the active locale and
// loads its message catalog — see i18n/request.ts.
const withNextIntl = createNextIntlPlugin('./i18n/request.ts');

const BASE_CSP = "frame-ancestors 'self'; base-uri 'self'; object-src 'none'";
// The dashboard's top-level folders (app/[locale]/(dashboard)), the private
// document links (/i, /d, /c) and the Confidential mode page. A new dashboard
// section belongs here too.
const STRICT_CONNECT_SECTIONS = [
  'activity', 'admin', 'bank', 'billing', 'classroom', 'contacts', 'dashboard', 'expenses', 'invoices', 'reports', 'settings', 'time', 'welcome',
  'i', 'd', 'c', 'security'
];

const backendUrl = (process.env.BACKEND_URL ?? 'http://localhost:3000').replace(/\/$/, '');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Fixed when the image is built, so a tab from before a deploy can tell (components/update-notice.tsx).
  env: { NEXT_PUBLIC_BUILD_STAMP: process.env.NEXT_PUBLIC_BUILD_STAMP ?? String(Date.now()) },
  // Caddy already strips `Server`; no reason to announce the framework either.
  poweredByHeader: false,
  // Rendered pages are cached in memory with a size cap, not on disk: the
  // on-demand municipality pages once filled the VPS disk (cache-handler.cjs).
  cacheHandler: fileURLToPath(new URL('./cache-handler.cjs', import.meta.url)),
  cacheMaxMemorySize: 0,
  // Standalone output traces the minimal server + node_modules needed to run
  // `node server.js` — lets apps/frontend/Dockerfile copy just that into a
  // slim runtime stage instead of the whole node_modules tree.
  // NEXT_STANDALONE=0 skips it for a local `next start`: the standalone copy
  // needs symlinks, which Windows refuses without Developer Mode.
  output: process.env.NEXT_STANDALONE === '0' ? undefined : 'standalone',
  // The Docker build on the small VPS skips the type check and lint that
  // `next build` would repeat: they run locally before every deploy.
  typescript: { ignoreBuildErrors: process.env.SKIP_BUILD_CHECKS === '1' },
  eslint: { ignoreDuringBuilds: process.env.SKIP_BUILD_CHECKS === '1' },
  // Public backend URLs shown to users (calendar/RSS feeds, API docs) are
  // built on the site origin. Behind Caddy those paths go straight to the
  // backend; without Caddy (local dev) Next forwards them.
  async redirects() {
    return legacyRedirects();
  },
  // Other sites may frame only the widgets under /embed (lib/embeds.ts).
  // Everything else, the app above all, stays same-origin; Caddy adds the
  // older X-Frame-Options on top, except for /embed.
  // base-uri and object-src cost nothing here (no <base>, no plugins) and take
  // away two script-injection tricks. A script-src would need per-request
  // nonces, which would make every cached marketing page dynamic.
  //
  // The app, the private document links and /security/confidential also get
  // connect-src 'self': the browser itself refuses any fetch, XHR, beacon or
  // WebSocket to another origin, so a decrypted text cannot leave by those
  // routes even if a script tried. That page explains it, and anyone can read
  // the header. blob: and data: stay local to the browser. None of these
  // pages load Clarity (marketing layout only) or talk to a third party from
  // the browser; Stripe, PayPal and bank sign-ins are redirects, not fetches.
  // The marketing pages keep the plain rule, as Clarity posts to its own host.
  // A later rule for the same header wins, so the strict one comes second.
  async headers() {
    return [
      { source: '/:path((?!embed/|badges/).*)', headers: [{ key: 'Content-Security-Policy', value: BASE_CSP }] },
      {
        source: `/:locale/:section(${STRICT_CONNECT_SECTIONS.join('|')})/:path*`,
        headers: [{ key: 'Content-Security-Policy', value: `${BASE_CSP}; connect-src 'self' blob: data:` }]
      },
      {
        source: '/embed/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: "frame-ancestors *; form-action 'none'; base-uri 'none'" },
          { key: 'X-Robots-Tag', value: 'noindex' }
        ]
      }
    ];
  },
  async rewrites() {
    return [
      { source: '/api/v1/feeds/:path*', destination: `${backendUrl}/api/v1/feeds/:path*` },
      // The live demo on /security/confidential posts here from the browser (Caddy routes it in production).
      { source: '/api/v1/public/vault-demo/:path*', destination: `${backendUrl}/api/v1/public/vault-demo/:path*` },
      { source: '/api/docs', destination: `${backendUrl}/api/docs` },
      { source: '/api/docs/:path*', destination: `${backendUrl}/api/docs/:path*` }
    ];
  }
};

export default withNextIntl(nextConfig);
