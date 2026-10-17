import { NextResponse } from 'next/server';
import { forwardJson } from '@/lib/forward-json';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Hover card on the invoice list: aggregates for one contact (tenant-scoped by the backend). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: 'bad_id' }, { status: 400 });
  return forwardJson(`/api/v1/contacts/${id}/summary`);
}
