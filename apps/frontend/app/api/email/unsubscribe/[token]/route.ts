import { NextResponse } from 'next/server';
import { routing } from '@/i18n/routing';
import { UNSUBSCRIBE_TOKEN, unsubscribeBackendUrl } from '@/lib/email-unsubscribe';

/**
 * The `List-Unsubscribe` target. Mail clients POST here for RFC 8058
 * one-click unsubscribe (body `List-Unsubscribe=One-Click`, no cookies);
 * the unsubscribe page's button POSTs here too.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!UNSUBSCRIBE_TOKEN.test(token)) return NextResponse.json({ error: 'invalid_unsubscribe_link' }, { status: 400 });
  try {
    const upstream = await fetch(unsubscribeBackendUrl(token), { method: 'POST', cache: 'no-store', signal: AbortSignal.timeout(10000) });
    return new NextResponse(await upstream.text(), { status: upstream.status, headers: { 'content-type': 'application/json' } });
  } catch {
    return NextResponse.json({ error: 'unsubscribe_unavailable' }, { status: 502 });
  }
}

/** Some clients open the header URL in a browser instead; show the confirm page rather than acting on a GET. */
export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return NextResponse.redirect(new URL(`/${routing.defaultLocale}/unsubscribe/${encodeURIComponent(token)}`, request.url), 303);
}
