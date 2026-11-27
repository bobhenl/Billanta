import { NextResponse } from 'next/server';
import { sameOrigin } from '@/lib/demo';
import { forwardJson } from '@/lib/forward-json';

const UUID = /^[0-9a-f-]{36}$/i;
const MAX_FILES = 10;
// PDF 5 MB + ISDOC 2 MB + ten 5 MB attachments, plus multipart overhead. The
// backend checks content and size again; this only stops an oversized body early.
const MAX_BYTES = 58 * 1024 * 1024;

/**
 * Důvěrný režim: sends the invoice e-mail with files the browser made or
 * decrypted for this one e-mail – a sealed invoice's PDF/ISDOC and decrypted
 * attachments – forwarded to `POST /api/v1/invoices/:id/send-with-files`. A
 * Route Handler because of the multipart body. Nothing here keeps or logs them.
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
  const files = incoming.getAll('files').filter((f): f is File => f instanceof File);
  if (files.length > MAX_FILES) return NextResponse.json({ error: 'too_many' }, { status: 400 });
  for (const file of files) body.append('files', file, file.name);
  if (!body.has('pdf') && !body.has('isdoc') && !files.length) return NextResponse.json({ error: 'no_file' }, { status: 400 });
  return forwardJson(`/api/v1/invoices/${params.id}/send-with-files`, { method: 'POST', body });
}
