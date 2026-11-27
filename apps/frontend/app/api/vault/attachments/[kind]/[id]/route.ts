import { NextResponse } from 'next/server';
import { forwardJson } from '@/lib/forward-json';

const UUID = /^[0-9a-f-]{36}$/i;

/** "Zašifrovat stávající přílohy": replaces one plain file with the ciphertext the browser made from it. */
export async function PUT(request: Request, props: { params: Promise<{ kind: string; id: string }> }) {
  const { kind, id } = await props.params;
  if ((kind !== 'invoice' && kind !== 'expense') || !UUID.test(id)) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const incoming = await request.formData();
  const file = incoming.get('file');
  const encMeta = incoming.get('enc_meta');
  if (!(file instanceof Blob) || typeof encMeta !== 'string' || !encMeta) return NextResponse.json({ error: 'not_encrypted' }, { status: 400 });
  const body = new FormData();
  body.set('file', file, 'encrypted.bin');
  body.set('enc_meta', encMeta);
  return forwardJson(`/api/v1/vault/attachments/${kind}/${id}`, { method: 'PUT', body });
}
