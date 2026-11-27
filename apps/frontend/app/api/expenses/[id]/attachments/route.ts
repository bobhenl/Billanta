import { NextResponse } from 'next/server';
import { forwardJson } from '@/lib/forward-json';

const UUID = /^[0-9a-f-]{36}$/i;

/** Receipt upload for an expense, forwarded to `POST /api/v1/expenses/:id/attachments` (multipart). */
export async function POST(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  if (!UUID.test(params.id)) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const incoming = await request.formData();
  const file = incoming.get('file');
  if (!(file instanceof Blob)) return NextResponse.json({ error: 'no_file' }, { status: 400 });
  const body = new FormData();
  body.set('file', file, file instanceof File ? file.name : 'uctenka');
  // Důvěrný režim: the file is ciphertext and this is its sealed key, name and type.
  const encMeta = incoming.get('enc_meta');
  if (typeof encMeta === 'string' && encMeta) body.set('enc_meta', encMeta);
  return forwardJson(`/api/v1/expenses/${params.id}/attachments`, { method: 'POST', body });
}
