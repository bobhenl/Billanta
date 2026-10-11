import { NextResponse } from 'next/server';
import { apiFetchRaw, ApiError, NotSignedInError } from '@/lib/api-client';

/**
 * Forwards a receipt photo/PDF (multipart field "file") to
 * `POST /api/v1/ai/receipt` as the signed-in user. A Route Handler rather
 * than a server action because server actions cap bodies at 1 MB and phone
 * photos are bigger; the backend enforces its own 10 MB limit.
 */
export async function POST(request: Request) {
  try {
    const incoming = await request.formData();
    const file = incoming.get('file');
    if (!(file instanceof Blob)) {
      return NextResponse.json({ error: 'no_file' }, { status: 400 });
    }
    const body = new FormData();
    body.set('file', file, file instanceof File ? file.name : 'receipt');
    const res = await apiFetchRaw('/api/v1/ai/receipt', { method: 'POST', body });
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
