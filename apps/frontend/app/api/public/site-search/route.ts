import { NextResponse } from 'next/server';
import { routing } from '@/i18n/routing';
import { clientIp } from '@/lib/client-ip';
import { takeToken } from '@/lib/rate-limit';
import { searchSite } from '@/lib/site-search';

/**
 * Autocomplete for the public /search box. Same in-memory index as the
 * server-rendered results page (public copy only: features, FAQ, pages,
 * municipalities), so nothing here is private. The middleware skips /api,
 * so the locale comes as a query parameter. One request per keystroke
 * (debounced in the client) is cheap, but it is still rate limited per IP.
 */
export function GET(request: Request): NextResponse {
  const ip = clientIp(request);
  if (ip && !takeToken(`site-search:${ip}`, 120, 60_000)) {
    return NextResponse.json({ hits: [] }, { status: 429, headers: { 'Retry-After': '60' } });
  }
  const url = new URL(request.url);
  const q = (url.searchParams.get('q') ?? '').trim().slice(0, 100);
  const requested = url.searchParams.get('locale') ?? '';
  const locale = (routing.locales as readonly string[]).includes(requested) ? requested : routing.defaultLocale;
  const hits = q ? searchSite(locale, q, 8) : [];
  return NextResponse.json({ hits }, { headers: { 'Cache-Control': 'public, max-age=300' } });
}
