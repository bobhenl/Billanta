import { NextResponse } from 'next/server';

const BACKEND_URL = (process.env.BACKEND_URL ?? 'http://localhost:3000').replace(/\/$/, '');

/** The PDF's two fonts for the /i/ page, which draws an encrypted document's PDF without a session. */
export async function GET(_request: Request, props: { params: Promise<{ weight: string }> }) {
  const { weight } = await props.params;
  if (weight !== 'regular' && weight !== 'bold') return NextResponse.json({ error: 'not_found' }, { status: 404 });
  let upstream: Response;
  try {
    upstream = await fetch(`${BACKEND_URL}/api/v1/public/invoices/pdf-fonts/${weight}`, { signal: AbortSignal.timeout(15000) });
  } catch {
    return NextResponse.json({ error: 'unavailable' }, { status: 502 });
  }
  if (!upstream.ok) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return new NextResponse(upstream.body, {
    status: 200,
    headers: { 'content-type': 'font/ttf', 'cache-control': 'public, max-age=604800, immutable', 'x-content-type-options': 'nosniff' },
  });
}
