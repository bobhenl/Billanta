import { NextResponse } from 'next/server';
import { apiFetchRaw, ApiError, NotSignedInError } from '@/lib/api-client';

/**
 * Forwards `POST /api/v1/backup-destinations/:id/run-now`. For a `local`
 * destination the backend answers with the SQLite file itself, which is
 * streamed straight through so the browser can save it; every other
 * destination answers with the JSON `backup_runs` row.
 */
export async function POST(_request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  if (!/^[0-9a-f-]{36}$/i.test(params.id)) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  try {
    const upstream = await apiFetchRaw(`/api/v1/backup-destinations/${params.id}/run-now`, { method: 'POST' });
    const headers = new Headers();
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
