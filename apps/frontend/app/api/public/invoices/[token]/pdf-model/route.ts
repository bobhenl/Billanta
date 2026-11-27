import { NextResponse } from 'next/server';
import { clientIp } from '@/lib/client-ip';
import { isPublicLinkSegment } from '@/lib/public-link';

const BACKEND_URL = (process.env.BACKEND_URL ?? 'http://localhost:3000').replace(/\/$/, '');

/**
 * The layout data the /i/ page draws an encrypted document's PDF from, in
 * the client's browser. Same token checks and per-visitor limit as `../pdf`.
 */
export async function GET(request: Request, props: { params: Promise<{ token: string }> }) {
  const { token } = await props.params;
  if (!isPublicLinkSegment(token)) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  let upstream: Response;
  try {
    upstream = await fetch(`${BACKEND_URL}/api/v1/public/invoices/${token}/pdf-model`, {
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
  return new NextResponse(upstream.body, {
    status: 200,
    headers: { 'content-type': 'application/json', 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' },
  });
}
