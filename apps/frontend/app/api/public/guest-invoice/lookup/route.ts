import { NextResponse } from 'next/server';
import { clientIp } from '@/lib/client-ip';

const BACKEND_URL = (process.env.BACKEND_URL ?? 'http://localhost:3000').replace(/\/$/, '');

/** ARES lookup by IČO for the guest invoice page (rate-limited by the backend). */
export async function GET(request: Request) {
  const ico = new URL(request.url).searchParams.get('ico') ?? '';
  const ip = clientIp(request);
  const upstream = await fetch(`${BACKEND_URL}/api/v1/public/guest-invoice/lookup?ico=${encodeURIComponent(ico)}`, {
    headers: ip ? { 'x-guest-ip': ip } : {},
    cache: 'no-store',
    signal: AbortSignal.timeout(15000)
  });
  return new NextResponse(await upstream.text(), { status: upstream.status, headers: { 'content-type': 'application/json' } });
}
