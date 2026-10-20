/** Server-only: the student-side calls of /api/classroom/*, which open a session like the demo does. */
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { clientIp } from '@/lib/client-ip';
import { classroomEnabled } from '@/lib/classroom';
import { sameOrigin } from '@/lib/demo';
import { openDemoSession } from '@/lib/demo-session';
import { CLASSROOM_LIMITS, allow } from '@/lib/rate-limit';

const BACKEND_URL = (process.env.BACKEND_URL ?? 'http://localhost:3000').replace(/\/$/, '');

/** Backend codes a student can be told about; anything else is "unavailable". */
const BACKEND_CODES: Record<string, number> = {
  classroom_not_found: 404,
  classroom_closed: 410,
  classroom_invalid_nickname: 400,
  classroom_invalid_kind: 400,
  classroom_class_full: 409,
  classroom_school_full: 409,
  classroom_nickname_taken: 409,
  classroom_reenter_invalid: 401,
  classroom_locked_out: 429,
  rate_limited: 429
};

export const fail = (error: string, status: number) => NextResponse.json({ error }, { status });

/**
 * Checks the request, forwards `body` to the public classroom route and,
 * on success, signs the browser in as the student. A real account's
 * session is never replaced without warning; an older demo or student
 * session is.
 */
export async function forwardStudentEntry(request: Request, path: 'join' | 'reenter', body: Record<string, unknown>, rule: keyof typeof CLASSROOM_LIMITS) {
  if (!classroomEnabled()) return fail('not_found', 404);
  if (!sameOrigin(request)) return fail('forbidden', 403);
  const ip = clientIp(request);
  if (!allow(`classroom-${path}:${ip || 'unknown'}`, CLASSROOM_LIMITS[rule])) return fail('rate_limited', 429);

  const session = await auth();
  if (session?.user && !session.isDemo) return fail('classroom_signed_in', 409);

  let entered: { userId: string; tenantId: string; sessionExpiresAt: string; redirect: string; nickname?: string; reentryCode?: string };
  try {
    const upstream = await fetch(`${BACKEND_URL}/api/v1/public/classroom/${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-demo-provision-secret': process.env.DEMO_PROVISION_SECRET ?? '',
        ...(ip ? { 'x-guest-ip': ip } : {})
      },
      body: JSON.stringify(body),
      cache: 'no-store',
      // Seeding a practice company takes a moment, as in the demo.
      signal: AbortSignal.timeout(20000)
    });
    if (!upstream.ok) {
      const payload = (await upstream.json().catch(() => null)) as { message?: unknown } | null;
      const code = typeof payload?.message === 'string' ? payload.message : '';
      const status = Object.hasOwn(BACKEND_CODES, code) ? BACKEND_CODES[code] : undefined;
      return status ? fail(code, status) : fail('classroom_unavailable', 503);
    }
    entered = await upstream.json();
  } catch {
    return fail('classroom_unavailable', 503);
  }

  const response = NextResponse.json({ redirect: entered.redirect, nickname: entered.nickname ?? null, reentryCode: entered.reentryCode ?? null });
  await openDemoSession(response, entered.userId, entered.tenantId, new Date(entered.sessionExpiresAt));
  return response;
}

/** The class preview for the /join page; fails soft to "not found". */
export async function fetchJoinPreview(code: string, ip: string) {
  if (!classroomEnabled()) return null;
  try {
    const res = await fetch(`${BACKEND_URL}/api/v1/public/classroom/preview`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-demo-provision-secret': process.env.DEMO_PROVISION_SECRET ?? '',
        // Without it every visitor would share the frontend server's bucket.
        ...(ip ? { 'x-guest-ip': ip } : {})
      },
      body: JSON.stringify({ code }),
      cache: 'no-store',
      signal: AbortSignal.timeout(5000)
    });
    if (!res.ok) return null;
    return (await res.json()) as import('@/lib/classroom').JoinPreview;
  } catch {
    return null;
  }
}
