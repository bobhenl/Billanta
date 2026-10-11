import { NextResponse } from 'next/server';
import { clientIp } from '@/lib/client-ip';

const BACKEND_URL = (process.env.BACKEND_URL ?? 'http://localhost:3000').replace(/\/$/, '');

function guestIp(request: Request) {
  return clientIp(request);
}

async function forward(request: Request, init: RequestInit) {
  const ip = guestIp(request);
  const upstream = await fetch(`${BACKEND_URL}/api/v1/public/guest-invoice/ai`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(ip ? { 'x-guest-ip': ip } : {}) },
    cache: 'no-store',
    signal: AbortSignal.timeout(60000)
  });
  return new NextResponse(await upstream.text(), { status: upstream.status, headers: { 'content-type': 'application/json' } });
}

/** AI fill for the guest invoice page: remaining tries (GET) and a suggestion (POST); capped by the backend. */
export async function GET(request: Request) {
  return forward(request, { method: 'GET' });
}

export async function POST(request: Request) {
  const body = await request.text();
  if (body.length > 5_000) return NextResponse.json({ error: 'too_large' }, { status: 413 });
  return forward(request, { method: 'POST', body });
}
