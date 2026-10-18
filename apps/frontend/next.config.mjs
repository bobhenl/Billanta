import { readFileSync } from 'node:fs';
import createNextIntlPlugin from 'next-intl/plugin';

// The public site used Czech slugs before it went English. Old links and
// indexed pages keep working through permanent redirects.
const legacy = JSON.parse(readFileSync(new URL('./lib/legacy-slugs.json', import.meta.url), 'utf8'));

function legacyRedirects() {
  const out = [];
  for (const prefix of ['/:locale(cs|sk|en)', '']) {
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

const backendUrl = (process.env.BACKEND_URL ?? 'http://localhost:3000').replace(/\/$/, '');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Caddy already strips `Server`; no reason to announce the framework either.
  poweredByHeader: false,
  // Standalone output traces the minimal server + node_modules needed to run
  // `node server.js` — lets apps/frontend/Dockerfile copy just that into a
  // slim runtime stage instead of the whole node_modules tree.
  output: 'standalone',
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
  async rewrites() {
    return [
      { source: '/api/v1/feeds/:path*', destination: `${backendUrl}/api/v1/feeds/:path*` },
      { source: '/api/docs', destination: `${backendUrl}/api/docs` },
      { source: '/api/docs/:path*', destination: `${backendUrl}/api/docs/:path*` }
    ];
  }
};

export default withNextIntl(nextConfig);
