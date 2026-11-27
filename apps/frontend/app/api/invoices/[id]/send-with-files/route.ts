import { NextResponse } from 'next/server';
import { sameOrigin } from '@/lib/demo';
import { forwardJson } from '@/lib/forward-json';

const UUID = /^[0-9a-f-]{36}$/i;
// The backend checks content and size again; this only stops an oversized body early.
const MAX_BYTES = 7 * 1024 * 1024;

/**
 * Důvěrný režim: sends a sealed invoice with the PDF/ISDOC rendered in the
 * browser, forwarded to `POST /api/v1/invoices/:id/send-with-files`. A Route
 * Handler because of the multipart body. Nothing here keeps or logs the files.
 */
export async function POST(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  if (!UUID.test(params.id)) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  // It e-mails the customer, so a form on another site must not be able to trigger it.
  if (!sameOrigin(request)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  if (Number(request.headers.get('content-length') ?? 0) > MAX_BYTES) return NextResponse.json({ error: 'file_too_large' }, { status: 413 });
  const incoming = await request.formData();
  const body = new FormData();
  for (const name of ['pdf', 'isdoc'] as const) {
    const file = incoming.get(name);
    if (file instanceof Blob) body.set(name, file, name === 'pdf' ? 'invoice.pdf' : 'invoice.isdoc');
  }
  if (!body.has('pdf') && !body.has('isdoc')) return NextResponse.json({ error: 'no_file' }, { status: 400 });
  return forwardJson(`/api/v1/invoices/${params.id}/send-with-files`, { method: 'POST', body });
}
