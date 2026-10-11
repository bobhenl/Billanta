import createNextIntlPlugin from 'next-intl/plugin';

// Points at the request-config module that resolves the active locale and
// loads its message catalog — see i18n/request.ts.
const withNextIntl = createNextIntlPlugin('./i18n/request.ts');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Standalone output traces the minimal server + node_modules needed to run
  // `node server.js` — lets apps/frontend/Dockerfile copy just that into a
  // slim runtime stage instead of the whole node_modules tree.
  output: 'standalone'
};

export default withNextIntl(nextConfig);
