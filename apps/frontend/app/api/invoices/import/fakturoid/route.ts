import { NextResponse } from 'next/server';
import { apiFetchRaw, ApiError, NotSignedInError } from '@/lib/api-client';

/**
 * Forwards `{ clientId, clientSecret, account?, dryRun, sellerIco? }` to
 * `POST /api/v1/invoices/import/fakturoid` as the signed-in user. The client
 * credentials pass through to the backend for this one request and are not
 * stored or logged here.
 */
export async function POST(request: Request) {
  try {
    const input = (await request.json().catch(() => null)) as {
      clientId?: unknown;
      clientSecret?: unknown;
      account?: unknown;
      dryRun?: unknown;
      sellerIco?: unknown;
    } | null;
    const body = JSON.stringify({
      clientId: typeof input?.clientId === 'string' ? input.clientId : '',
      clientSecret: typeof input?.clientSecret === 'string' ? input.clientSecret : '',
      ...(typeof input?.account === 'string' && input.account.trim() ? { account: input.account } : {}),
      dryRun: input?.dryRun === true,
      ...(typeof input?.sellerIco === 'string' && /^\d{8}$/.test(input.sellerIco) ? { sellerIco: input.sellerIco } : {})
    });
    const res = await apiFetchRaw('/api/v1/invoices/import/fakturoid', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body
    });
    return NextResponse.json(await res.json());
  } catch (error) {
    if (error instanceof NotSignedInError) return NextResponse.json({ error: 'not_signed_in' }, { status: 401 });
    if (error instanceof ApiError) {
      return new NextResponse(error.body || JSON.stringify({ error: 'backend_error' }), {
        status: error.status,
        headers: { 'content-type': 'application/json' }
      });
    }
    return NextResponse.json({ error: 'failed' }, { status: 500 });
  }
}
