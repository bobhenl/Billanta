import { forwardStudentEntry } from '@/lib/classroom-join';

/** Back into one's practice company from another device, with the personal code. */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { code?: unknown; personalCode?: unknown } | null;
  return forwardStudentEntry(request, 'reenter', { code: body?.code, personalCode: body?.personalCode }, 'reenterPerIp');
}
