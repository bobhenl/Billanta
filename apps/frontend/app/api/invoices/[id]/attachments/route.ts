import { NextResponse } from 'next/server';
import { forwardJson } from '@/lib/forward-json';

const UUID = /^[0-9a-f-]{36}$/i;

/**
 * Invoice attachment upload, forwarded to `POST /api/v1/invoices/:id/attachments`
 * (a Route Handler like the logo upload, because of the multipart body).
 */
export async function POST(request: Request, props: { params: Promise<{ id: string }> }) {
 const params = await props.params;
 if (!UUID.test(params.id)) return NextResponse.json({ error: 'not_found' }, { status: 404 });
 const incoming = await request.formData();
 const file = incoming.get('file');
 if (!(file instanceof Blob)) return NextResponse.json({ error: 'no_file' }, { status: 400 });
 const body = new FormData();
 body.set('file', file, file instanceof File ? file.name : 'priloha');
 return forwardJson(`/api/v1/invoices/${params.id}/attachments`, { method: 'POST', body });
}
