import { NextResponse } from 'next/server';
import { clientIp } from '@/lib/client-ip';
import { isBuyerDetailsToken } from '@/lib/public-buyer-details';

const BACKEND_URL = (process.env.BACKEND_URL ?? 'http://localhost:3000').replace(/\/$/, '');

/**
 * ARES/RPO (IČO) or VIES (VAT ID) lookup for the buyer-details page, or with
 * `?q=` a name typeahead in the register of `?country=`. Only works for an
 * open link; rate-limited by the backend.
 */
export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!isBuyerDetailsToken(token)) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const search = new URL(request.url).searchParams;
  const query = new URLSearchParams();
  const ico = search.get('ico');
  const vat = search.get('vat');
  const q = search.get('q');
  const country = search.get('country');
  if (ico) query.set('ico', ico.slice(0, 20));
  else if (vat) query.set('vat', vat.slice(0, 20));
  else if (q) query.set('q', q.slice(0, 120));
  if (country && /^[A-Za-z]{2}$/.test(country)) query.set('country', country.toUpperCase());
  const ip = clientIp(request);
  try {
    const upstream = await fetch(`${BACKEND_URL}/api/v1/public/buyer-details/${encodeURIComponent(token)}/lookup?${query}`, {
      headers: ip ? { 'x-guest-ip': ip } : {},
      cache: 'no-store',
      signal: AbortSignal.timeout(15000)
    });
    return new NextResponse(await upstream.text(), { status: upstream.status, headers: { 'content-type': 'application/json' } });
  } catch {
    return NextResponse.json({ error: 'failed' }, { status: 502 });
  }
}
