import { NextResponse } from 'next/server';

const BACKEND_URL = (process.env.BACKEND_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const UUID = /^[0-9a-f-]{36}$/i;

/**
 * Client-portal attachment download. Unauthenticated on purpose, like the
 * portal page itself: the backend only serves files the supplier marked
 * "show in portal" for that token.
 */
export async function GET(
  _request: Request,
  props: { params: Promise<{ token: string; attachmentId: string }> }
) {
  const params = await props.params;
  if (!UUID.test(params.token) || !UUID.test(params.attachmentId)) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const upstream = await fetch(`${BACKEND_URL}/api/v1/public/invoices/${params.token}/attachments/${params.attachmentId}`, { cache: 'no-store' });
  if (!upstream.ok) return NextResponse.json({ error: 'not_found' }, { status: upstream.status === 404 ? 404 : 502 });
  const headers = new Headers();
  for (const name of ['content-type', 'content-disposition', 'cache-control', 'x-content-type-options']) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  return new NextResponse(upstream.body, { status: 200, headers });
}
