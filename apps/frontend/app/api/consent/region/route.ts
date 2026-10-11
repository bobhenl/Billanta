import { NextResponse } from 'next/server';
import { bannerFor, regionHeaders } from '@/lib/consent-region';

export const dynamic = 'force-dynamic';

/**
 * Whether this visitor needs the cookie banner, as `{"banner": bool}`
 * (lib/consent-region.ts). Asked by the browser rather than decided while
 * rendering, so the marketing pages stay the same HTML for every country and
 * can be cached. The answer varies by country, so it is never cached
 * anywhere shared; it sets no cookie, logs nothing and does not echo the
 * country back.
 */
export function GET(request: Request) {
  const { country, region } = regionHeaders(request.headers);
  return NextResponse.json(
    { banner: bannerFor(country, region) },
    { headers: { 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex' } }
  );
}
