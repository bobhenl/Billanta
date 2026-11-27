import { NextResponse } from 'next/server';
import { forwardJson } from '@/lib/forward-json';

const UUID = /^[0-9a-f-]{36}$/i;
type Params = { params: Promise<{ id: string; attachmentId: string }> };

export async function DELETE(_request: Request, ctx: Params) {
  const { id, attachmentId } = await ctx.params;
  if (!UUID.test(id) || !UUID.test(attachmentId)) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return forwardJson(`/api/v1/expenses/${id}/attachments/${attachmentId}`, { method: 'DELETE' });
}
