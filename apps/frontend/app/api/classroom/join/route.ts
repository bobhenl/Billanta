import { forwardStudentEntry } from '@/lib/classroom-join';

/** A student joins a class by its code and lands in their own practice company. */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { code?: unknown; nickname?: unknown; kind?: unknown } | null;
  return forwardStudentEntry(request, 'join', { code: body?.code, nickname: body?.nickname, kind: body?.kind }, 'joinPerIp');
}
