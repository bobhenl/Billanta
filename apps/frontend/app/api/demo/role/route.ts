import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { ApiError, apiFetch, fetchMyCompanies } from '@/lib/api-client';
import { DEMO_VIEW_ROLES, sameOrigin } from '@/lib/demo';
import { openDemoSession } from '@/lib/demo-session';
import { fetchTenant } from '@/lib/tenant';

const fail = (error: string, status: number) => NextResponse.json({ error }, { status });

/**
 * "Look at it as …" in the demo banner: the backend hands back the demo user
 * holding that role in this company (made on first use), and the browser's
 * session moves to them. Everything after that is the real role check, so
 * the accountant and the read-only colleague see exactly what they would.
 */
export async function POST(request: Request) {
  if (!sameOrigin(request)) return fail('forbidden', 403);
  if (!(await auth())?.isDemo) return fail('not_found', 404);

  const body = (await request.json().catch(() => null)) as { role?: unknown } | null;
  const role = DEMO_VIEW_ROLES.find((r) => r === body?.role);
  if (!role) return fail('invalid_role', 400);

  try {
    const [{ userId }, tenant, { active }] = await Promise.all([
      apiFetch<{ userId: string }>('/api/v1/demo/role', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ role })
      }),
      fetchTenant(),
      fetchMyCompanies()
    ]);
    if (!tenant?.demoExpiresAt) return fail('demo_expired', 410);
    const response = NextResponse.json({ ok: true });
    await openDemoSession(response, userId, active.id, new Date(tenant.demoExpiresAt));
    return response;
  } catch (error) {
    return fail(error instanceof ApiError && error.status === 410 ? 'demo_expired' : 'demo_unavailable', 503);
  }
}
