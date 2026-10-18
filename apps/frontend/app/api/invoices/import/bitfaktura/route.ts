import { NextResponse } from 'next/server';
import { apiFetchRaw, ApiError, NotSignedInError } from '@/lib/api-client';

/**
 * Forwards `{ account, apiToken, dryRun, sellerIco? }` to `POST /api/v1/invoices/import/bitfaktura`
 * as the signed-in user. The token passes through to the backend for this one
 * request and is not stored or logged here.
 */
export async function POST(request: Request) {
  try {
    const input = (await request.json().catch(() => null)) as { account?: unknown; apiToken?: unknown; dryRun?: unknown; sellerIco?: unknown } | null;
    const body = JSON.stringify({
      account: typeof input?.account === 'string' ? input.account : '',
      apiToken: typeof input?.apiToken === 'string' ? input.apiToken : '',
      dryRun: input?.dryRun === true,
      ...(typeof input?.sellerIco === 'string' && /^\d{8}$/.test(input.sellerIco) ? { sellerIco: input.sellerIco } : {})
    });
    const res = await apiFetchRaw('/api/v1/invoices/import/bitfaktura', {
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
