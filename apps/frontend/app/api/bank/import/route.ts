import { NextResponse } from 'next/server';
import { apiFetchRaw, ApiError, NotSignedInError } from '@/lib/api-client';

/**
 * Forwards a bank statement (CSV, camt.053, GPC; multipart field "file") to
 * `POST /api/v1/bank-reconciliation/import` as the signed-in user. A Route
 * Handler for the same reason as `/api/ai/receipt`: statements can exceed
 * the 1 MB server-action body cap.
 */
export async function POST(request: Request) {
  try {
    const incoming = await request.formData();
    const file = incoming.get('file');
    if (!(file instanceof Blob)) {
      return NextResponse.json({ error: 'no_file' }, { status: 400 });
    }
    const body = new FormData();
    body.set('file', file, file instanceof File ? file.name : 'statement.csv');
    const res = await apiFetchRaw('/api/v1/bank-reconciliation/import', { method: 'POST', body });
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
