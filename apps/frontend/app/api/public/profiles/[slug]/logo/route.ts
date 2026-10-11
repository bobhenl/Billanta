import { NextResponse } from 'next/server';

const BACKEND_URL = (process.env.BACKEND_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const SLUG = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/;

/** Logo of a published public profile; the backend answers 404 when hidden, missing or unpublished. */
export async function GET(_request: Request, props: { params: Promise<{ slug: string }> }) {
  const params = await props.params;
  const slug = params.slug.toLowerCase();
  if (!SLUG.test(slug)) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const upstream = await fetch(`${BACKEND_URL}/api/v1/public/profiles/${slug}/logo`, { cache: 'no-store' });
  if (!upstream.ok) return NextResponse.json({ error: 'not_found' }, { status: upstream.status === 404 ? 404 : 502 });
  const headers = new Headers({ 'cache-control': 'public, max-age=300', 'x-content-type-options': 'nosniff' });
  const type = upstream.headers.get('content-type');
  if (type) headers.set('content-type', type);
  return new NextResponse(upstream.body, { status: 200, headers });
}
