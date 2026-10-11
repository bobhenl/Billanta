import createNextIntlPlugin from 'next-intl/plugin';

// Points at the request-config module that resolves the active locale and
// loads its message catalog — see i18n/request.ts.
const withNextIntl = createNextIntlPlugin('./i18n/request.ts');

const backendUrl = (process.env.BACKEND_URL ?? 'http://localhost:3000').replace(/\/$/, '');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Standalone output traces the minimal server + node_modules needed to run
  // `node server.js` — lets apps/frontend/Dockerfile copy just that into a
  // slim runtime stage instead of the whole node_modules tree.
  output: 'standalone',
  // Public backend URLs shown to users (calendar/RSS feeds, API docs) are
  // built on the site origin. Behind Caddy those paths go straight to the
  // backend; without Caddy (local dev) Next forwards them.
  async rewrites() {
    return [
      { source: '/api/v1/feeds/:path*', destination: `${backendUrl}/api/v1/feeds/:path*` },
      { source: '/api/docs', destination: `${backendUrl}/api/docs` },
      { source: '/api/docs/:path*', destination: `${backendUrl}/api/docs/:path*` }
    ];
  }
};

export default withNextIntl(nextConfig);
