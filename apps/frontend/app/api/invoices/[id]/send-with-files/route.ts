import { NextResponse } from 'next/server';
import { forwardJson } from '@/lib/forward-json';

const UUID = /^[0-9a-f-]{36}$/i;
const MAX_FILES = 10;

/**
 * Sends the invoice e-mail with attachments the browser decrypted just for
 * this e-mail (Důvěrný režim). The files pass through once; nothing here or
 * in the backend keeps them beyond the e-mail outbox until delivery.
 */
export async function POST(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  if (!UUID.test(params.id)) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const incoming = await request.formData();
  const files = incoming.getAll('files').filter((f): f is File => f instanceof File);
  if (files.length > MAX_FILES) return NextResponse.json({ error: 'too_many' }, { status: 400 });
  const body = new FormData();
  for (const file of files) body.append('files', file, file.name);
  return forwardJson(`/api/v1/invoices/${params.id}/send-with-files`, { method: 'POST', body });
}
