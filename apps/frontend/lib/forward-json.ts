import { NextResponse } from 'next/server';
import { apiFetchRaw, ApiError, NotSignedInError } from '@/lib/api-client';

/** Forwards to the backend as the signed-in user and relays its JSON (or error) as-is. */
export async function forwardJson(path: string, init?: RequestInit) {
  try {
    const res = await apiFetchRaw(path, init);
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
