import { NextResponse } from 'next/server';
import { apiFetchRaw, ApiError, NotSignedInError } from '@/lib/api-client';

/**
 * Forwards an invoice-history CSV (multipart field "file") to
 * `POST /api/v1/invoices/import` as the signed-in user; `?dryRun=1` only
 * previews. A Route Handler because exports can exceed the server-action
 * body cap (same as `/api/contacts/import`).
 */
export async function POST(request: Request) {
  try {
    const dryRun = new URL(request.url).searchParams.get('dryRun') === '1';
    const incoming = await request.formData();
    const file = incoming.get('file');
    if (!(file instanceof Blob)) {
      return NextResponse.json({ error: 'no_file' }, { status: 400 });
    }
    const body = new FormData();
    body.set('file', file, file instanceof File ? file.name : 'invoices.csv');
    const res = await apiFetchRaw(`/api/v1/invoices/import${dryRun ? '?dryRun=1' : ''}`, { method: 'POST', body });
    return NextResponse.json(await res.json());
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
