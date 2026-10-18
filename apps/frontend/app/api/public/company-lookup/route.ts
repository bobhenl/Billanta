import { NextResponse } from 'next/server';
import { clientIp } from '@/lib/client-ip';

const BACKEND_URL = (process.env.BACKEND_URL ?? 'http://localhost:3000').replace(/\/$/, '');

/**
 * Public company lookup for forms filled in without an account (order form
 * on a public profile and similar): `?q=` name / IČO / VAT number, optional
 * `?country=` or `?registry=`. Rate-limited per visitor by the backend.
 */
export async function GET(request: Request) {
  const search = new URL(request.url).searchParams;
  const query = new URLSearchParams();
  const q = (search.get('q') ?? '').trim().slice(0, 120);
  if (q.length < 2) return NextResponse.json({ hits: [] });
  query.set('q', q);
  const country = search.get('country');
  const registry = search.get('registry');
  if (country && /^[A-Za-z]{2}$/.test(country)) query.set('country', country.toUpperCase());
  if (registry && /^[A-Za-z]{2,5}$/.test(registry)) query.set('registry', registry);
  const ip = clientIp(request);
  try {
    const upstream = await fetch(`${BACKEND_URL}/api/v1/public/company-lookup?${query}`, {
      headers: ip ? { 'x-guest-ip': ip } : {},
      cache: 'no-store',
      signal: AbortSignal.timeout(12000)
    });
    if (!upstream.ok) return NextResponse.json({ hits: [], error: upstream.status === 429 ? 'rate_limited' : 'failed' }, { status: upstream.status === 429 ? 429 : 200 });
    return new NextResponse(await upstream.text(), { status: 200, headers: { 'content-type': 'application/json' } });
  } catch {
    return NextResponse.json({ hits: [] });
  }
}
