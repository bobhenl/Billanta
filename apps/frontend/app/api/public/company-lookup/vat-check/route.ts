import { NextResponse } from 'next/server';
import { clientIp } from '@/lib/client-ip';

const BACKEND_URL = (process.env.BACKEND_URL ?? 'http://localhost:3000').replace(/\/$/, '');

/**
 * Public VAT check for the company lookup tool: `?dic=` a DIČ / EU VAT
 * number, answered from the CZ register of VAT payers (with the
 * nespolehlivý plátce flag) or VIES. Rate-limited per visitor by the backend
 * (a stricter limit than the search, every call reaches ADIS or VIES).
 * Optional `?account=` (the unreliable-payer tool): the answer then says
 * whether that account is among the published ones, never which they are.
 */
export async function GET(request: Request) {
  const dic = (new URL(request.url).searchParams.get('dic') ?? '').replace(/[\s.-]/g, '').toUpperCase();
  if (!/^[A-Z]{2}[0-9A-Z+*]{2,12}$/.test(dic)) return NextResponse.json(null);
  const account = (new URL(request.url).searchParams.get('account') ?? '').trim().slice(0, 60);
  const query = new URLSearchParams({ dic });
  if (account) query.set('account', account);
  const ip = clientIp(request);
  try {
    const upstream = await fetch(`${BACKEND_URL}/api/v1/public/company-lookup/vat-check?${query}`, {
      headers: ip ? { 'x-guest-ip': ip } : {},
      cache: 'no-store',
      signal: AbortSignal.timeout(10000)
    });
    if (upstream.status === 429) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
    if (!upstream.ok) return NextResponse.json(null);
    // Nest sends an empty body for a null answer.
    const body = await upstream.text();
    return body ? new NextResponse(body, { status: 200, headers: { 'content-type': 'application/json' } }) : NextResponse.json(null);
  } catch {
    return NextResponse.json(null);
  }
}
