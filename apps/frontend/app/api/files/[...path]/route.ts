import { NextResponse, type NextRequest } from 'next/server';
import { apiFetchRaw, ApiError, NotSignedInError } from '@/lib/api-client';

/**
 * Same-origin download proxy: the browser never holds a backend JWT, so
 * file links (`/api/files/invoices/<id>/pdf`, `/api/files/exports/pohoda.xml?month=…`)
 * go through here and are forwarded with the signed-in user's identity.
 * Only the listed download endpoints are reachable.
 */
const ALLOWED = [
  /^invoices\/[0-9a-f-]{36}\/(pdf|isdoc|ubl)$/i,
  /^invoices\/[0-9a-f-]{36}\/attachments\/[0-9a-f-]{36}$/i,
  /^tenants\/me\/logo$/,
  /^contacts\/export\.csv$/,
  /^exports\/(invoices\.csv|expenses\.csv|pohoda\.xml|money-s3\.xml|dphdp3\.xml|dphkh1\.xml|dphshv\.xml|annual-summary|annual-summary\.csv)$/
];

export async function GET(request: NextRequest, props: { params: Promise<{ path: string[] }> }) {
  const params = await props.params;
  const path = params.path.join('/');
  if (!ALLOWED.some((re) => re.test(path))) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  try {
    const upstream = await apiFetchRaw(`/api/v1/${path}${request.nextUrl.search}`);
    const headers = new Headers();
    for (const name of ['content-type', 'content-disposition', 'cache-control']) {
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
