import { NextResponse } from 'next/server';
import { clientIp } from '@/lib/client-ip';
import { NEWSLETTER_CONFIRM_TOKEN } from '@/lib/newsletter';

const BACKEND_URL = (process.env.BACKEND_URL ?? 'http://localhost:3000').replace(/\/$/, '');

/** The confirm button on /newsletter/confirm/:token. POST only: mail scanners open links, so GET never confirms. */
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!NEWSLETTER_CONFIRM_TOKEN.test(token)) return NextResponse.json({ error: 'invalid_confirm_link' }, { status: 400 });
  const ip = clientIp(request);
  try {
    const upstream = await fetch(`${BACKEND_URL}/api/v1/public/newsletter/confirm/${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: ip ? { 'x-guest-ip': ip } : {},
      cache: 'no-store',
      signal: AbortSignal.timeout(10000)
    });
    if (upstream.status === 429) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
    const body = (await upstream.json().catch(() => null)) as { message?: string } | null;
    if (upstream.status === 400 || upstream.status === 404 || upstream.status === 410) {
      const error = body?.message === 'confirm_link_expired' ? 'confirm_link_expired' : 'invalid_confirm_link';
      return NextResponse.json({ error }, { status: 400 });
    }
    if (!upstream.ok) return NextResponse.json({ error: 'unavailable' }, { status: 502 });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'unavailable' }, { status: 502 });
  }
}
