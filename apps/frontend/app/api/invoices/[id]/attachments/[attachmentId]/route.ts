import { NextResponse } from 'next/server';
import { forwardJson } from '@/lib/forward-json';

const UUID = /^[0-9a-f-]{36}$/i;
type Params = { params: Promise<{ id: string; attachmentId: string }> };

const path = async (ctx: Params) => {
  const { id, attachmentId } = await ctx.params;
  return UUID.test(id) && UUID.test(attachmentId) ? `/api/v1/invoices/${id}/attachments/${attachmentId}` : null;
};

/** Toggles "send with email" / "show in portal". */
export async function PATCH(request: Request, ctx: Params) {
  const target = await path(ctx);
  if (!target) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const body = (await request.json().catch(() => ({}))) as { send_with_email?: unknown; show_in_portal?: unknown };
  return forwardJson(target, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ send_with_email: body.send_with_email, show_in_portal: body.show_in_portal })
  });
}

export async function DELETE(_request: Request, ctx: Params) {
  const target = await path(ctx);
  if (!target) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return forwardJson(target, { method: 'DELETE' });
}
