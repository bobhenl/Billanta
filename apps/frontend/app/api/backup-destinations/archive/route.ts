import { NextResponse } from 'next/server';
import { apiFetchRaw, ApiError, NotSignedInError } from '@/lib/api-client';

/**
 * Forwards `GET /api/v1/backup-destinations/archive.zip?year=…`. The backend
 * writes the ZIP document by document, so the body is passed through as a
 * stream and a plain link is enough to start the download.
 */
export async function GET(request: Request) {
  const year = new URL(request.url).searchParams.get('year') ?? 'all';
  if (year !== 'all' && !/^\d{4}$/.test(year)) {
    return NextResponse.json({ error: 'invalid_year' }, { status: 400 });
  }
  try {
    const upstream = await apiFetchRaw(`/api/v1/backup-destinations/archive.zip?year=${year}`);
    const headers = new Headers({ 'cache-control': 'no-store' });
    for (const name of ['content-type', 'content-disposition']) {
      const value = upstream.headers.get(name);
      if (value) headers.set(name, value);
    }
    return new NextResponse(upstream.body, { status: 200, headers });
  } catch (error) {
    if (error instanceof NotSignedInError) return NextResponse.json({ error: 'not_signed_in' }, { status: 401 });
    if (error instanceof ApiError) {
      return new NextResponse(error.body || JSON.stringify({ error: 'backend_error' }), {
        status: error.status,
        headers: { 'content-type': 'application/json' }
      });
    }
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
