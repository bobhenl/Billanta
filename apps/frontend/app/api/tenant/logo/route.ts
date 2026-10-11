import { NextResponse } from 'next/server';
import { apiFetchRaw, ApiError, NotSignedInError } from '@/lib/api-client';

/**
 * Company logo upload/removal, forwarded to `PUT|DELETE /api/v1/tenants/me/logo`
 * as the signed-in user (a Route Handler, like `/api/bank/import`, because a
 * multipart body does not go through server actions nicely).
 */
async function forward(init: RequestInit) {
  try {
    const res = await apiFetchRaw('/api/v1/tenants/me/logo', init);
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

export async function POST(request: Request) {
  const incoming = await request.formData();
  const file = incoming.get('file');
  if (!(file instanceof Blob)) return NextResponse.json({ error: 'no_file' }, { status: 400 });
  const body = new FormData();
  body.set('file', file, file instanceof File ? file.name : 'logo');
  return forward({ method: 'PUT', body });
}

export async function DELETE() {
  return forward({ method: 'DELETE' });
}
