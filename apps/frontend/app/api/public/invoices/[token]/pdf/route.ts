import { NextResponse } from 'next/server';
import { clientIp } from '@/lib/client-ip';
import { isPublicLinkSegment } from '@/lib/public-link';

const BACKEND_URL = (process.env.BACKEND_URL ?? 'http://localhost:3000').replace(/\/$/, '');

/**
 * The invoice PDF behind the /i/ page's download button. Unauthenticated
 * like the page; the backend applies the page's own token checks and
 * rate-limits per visitor, hence `x-guest-ip`.
 */
export async function GET(request: Request, props: { params: Promise<{ token: string }> }) {
  const { token } = await props.params;
  if (!isPublicLinkSegment(token)) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  let upstream: Response;
  try {
    upstream = await fetch(`${BACKEND_URL}/api/v1/public/invoices/${token}/pdf`, {
      cache: 'no-store',
      headers: { 'x-guest-ip': clientIp(request) },
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    return NextResponse.json({ error: 'unavailable' }, { status: 502 });
  }
  if (!upstream.ok) {
    const status = upstream.status === 404 || upstream.status === 429 ? upstream.status : 502;
    return NextResponse.json({ error: status === 404 ? 'not_found' : status === 429 ? 'too_many_requests' : 'unavailable' }, { status });
  }
  const headers = new Headers();
  for (const name of ['content-type', 'content-disposition', 'cache-control', 'x-content-type-options']) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  return new NextResponse(upstream.body, { status: 200, headers });
}
