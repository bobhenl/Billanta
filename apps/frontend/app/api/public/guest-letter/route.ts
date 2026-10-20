import { NextResponse } from 'next/server';
import { clientIp } from '@/lib/client-ip';

const BACKEND_URL = (process.env.BACKEND_URL ?? 'http://localhost:3000').replace(/\/$/, '');

/**
 * Payment reminder letter PDF from the public reminder generator. Unauthenticated
 * on purpose; the backend validates the body, stores nothing and rate-limits
 * per visitor IP, which is passed on as `x-guest-ip` because every request
 * reaches the backend from this server.
 */
export async function POST(request: Request) {
  const body = await request.text();
  if (body.length > 20_000) return NextResponse.json({ error: 'too_large' }, { status: 413 });
  const ip = clientIp(request);
  const upstream = await fetch(`${BACKEND_URL}/api/v1/public/guest-invoice/letter`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(ip ? { 'x-guest-ip': ip } : {}) },
    body,
    cache: 'no-store',
    signal: AbortSignal.timeout(15000)
  });
  if (!upstream.ok) {
    return new NextResponse(await upstream.text(), { status: upstream.status, headers: { 'content-type': 'application/json' } });
  }
  const headers = new Headers();
  for (const name of ['content-type', 'content-disposition', 'cache-control']) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  return new NextResponse(upstream.body, { status: 200, headers });
}
