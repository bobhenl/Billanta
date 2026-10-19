import { NextResponse, type NextRequest } from 'next/server';
import { apiFetchRaw, ApiError, NotSignedInError } from '@/lib/api-client';

/**
 * Same-origin download proxy: the browser never holds a backend JWT, so
 * file links (`/api/files/invoices/<id>/pdf`, `/api/files/exports/pohoda.xml?month=…`)
 * go through here and are forwarded with the signed-in user's identity.
 * Only the listed download endpoints are reachable.
 */
const ALLOWED = [
  // Route names stay case-sensitive (only the ids may be upper-case).
  /^invoices\/[0-9a-fA-F-]{36}\/(pdf|isdoc|ubl)$/,
  /^invoices\/[0-9a-fA-F-]{36}\/attachments\/[0-9a-fA-F-]{36}$/,
  /^tenants\/me\/logo$/,
  /^contacts\/export\.csv$/,
  /^classroom\/classes\/[0-9a-fA-F-]{36}\/progress\.csv$/,
  /^exports\/(invoices\.csv|expenses\.csv|pohoda\.xml|money-s3\.xml|dphdp3\.xml|dphkh1\.xml|dphshv\.xml|sk\/dphv25\.xml|sk\/kvdph\.xml|sk\/svdph\.xml|annual-summary|annual-summary\.csv|annual-filings)$/
];

// Downloads that carry personal data (rodné číslo) in the body rather than the URL.
const ALLOWED_POST = [/^exports\/annual-filings\/(dpfdp|osvc)\.xml$/];

export async function GET(request: NextRequest, props: { params: Promise<{ path: string[] }> }) {
  const params = await props.params;
  const path = params.path.join('/');
  if (!ALLOWED.some((re) => re.test(path))) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  try {
    const upstream = await apiFetchRaw(`/api/v1/${path}${request.nextUrl.search}`);
    const headers = new Headers();
    // x-vat-warnings: what the VAT export box tells the person to fix (exports.controller.ts).
    for (const name of ['content-type', 'content-disposition', 'cache-control', 'x-vat-warnings']) {
      const value = upstream.headers.get(name);
      if (value) headers.set(name, value);
    }
    return new NextResponse(upstream.body, { status: 200, headers });
  } catch (error) {
    if (error instanceof NotSignedInError) return NextResponse.json({ error: 'not_signed_in' }, { status: 401 });
    if (error instanceof ApiError) return new NextResponse(error.body, { status: error.status });
    throw error;
  }
}

export async function POST(request: NextRequest, props: { params: Promise<{ path: string[] }> }) {
  const params = await props.params;
  const path = params.path.join('/');
  if (!ALLOWED_POST.some((re) => re.test(path))) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  // JSON only: a cross-site HTML form cannot send it, so this stays a same-origin call.
  if (!request.headers.get('content-type')?.startsWith('application/json')) {
    return NextResponse.json({ error: 'unsupported_media_type' }, { status: 415 });
  }
  try {
    const upstream = await apiFetchRaw(`/api/v1/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: await request.text()
    });
    const headers = new Headers({ 'cache-control': 'no-store' });
    for (const name of ['content-type', 'content-disposition']) {
      const value = upstream.headers.get(name);
      if (value) headers.set(name, value);
    }
    return new NextResponse(upstream.body, { status: 200, headers });
  } catch (error) {
    if (error instanceof NotSignedInError) return NextResponse.json({ error: 'not_signed_in' }, { status: 401 });
    if (error instanceof ApiError) return new NextResponse(error.body, { status: error.status });
    throw error;
  }
}
