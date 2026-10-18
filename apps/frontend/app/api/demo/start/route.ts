import { NextResponse } from 'next/server';
import { auth, createDemoSession, sessionCookieName } from '@/auth';
import { routing } from '@/i18n/routing';
import { ACTIVE_TENANT_COOKIE } from '@/lib/api-client';
import { clientIp } from '@/lib/client-ip';
import { demoEnabled, isDemoKind, sameOrigin, secureCookies } from '@/lib/demo';
import { DEMO_LIMITS, allow } from '@/lib/rate-limit';

const BACKEND_URL = (process.env.BACKEND_URL ?? 'http://localhost:3000').replace(/\/$/, '');

/** Codes the backend may answer with that the picker can explain; anything else is "unavailable". */
const BACKEND_CODES: Record<string, number> = { demo_ip_limit: 429, demo_capacity: 503 };

const fail = (error: string, status: number) => NextResponse.json({ error }, { status });

/**
 * Starts a demo (docs/demo-playground-plan.md): the backend creates and seeds
 * a throwaway company, this route opens a database session for its user and
 * sets the cookies, so the visitor lands in a real dashboard.
 */
export async function POST(request: Request) {
  if (!demoEnabled()) return fail('not_found', 404);
  if (!sameOrigin(request)) return fail('forbidden', 403);

  const ip = clientIp(request);
  if (!allow(`demo-start:${ip || 'unknown'}`, DEMO_LIMITS.startPerIp)) return fail('rate_limited', 429);

  // Starting a demo replaces the session cookie, which would sign a real user
  // out without warning. An older demo session is fine to replace.
  const session = await auth();
  if (session?.user && !session.isDemo) return fail('demo_signed_in', 409);

  const body = (await request.json().catch(() => null)) as { kind?: unknown; locale?: unknown } | null;
  if (!isDemoKind(body?.kind)) return fail('invalid_kind', 400);
  const locale = routing.locales.find((l) => l === body?.locale) ?? routing.defaultLocale;

  let created: { userId: string; tenantId: string; expiresAt: string };
  try {
    const upstream = await fetch(`${BACKEND_URL}/api/v1/public/demo`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-demo-provision-secret': process.env.DEMO_PROVISION_SECRET ?? '',
        ...(ip ? { 'x-guest-ip': ip } : {})
      },
      body: JSON.stringify({ kind: body.kind }),
      cache: 'no-store',
      // Seeding a company with ~20 invoices takes a moment.
      signal: AbortSignal.timeout(20000)
    });
    if (!upstream.ok) {
      const payload = (await upstream.json().catch(() => null)) as { message?: unknown } | null;
      const code = typeof payload?.message === 'string' ? payload.message : '';
      const status = Object.hasOwn(BACKEND_CODES, code) ? BACKEND_CODES[code] : undefined;
      return status ? fail(code, status) : fail('demo_unavailable', 503);
    }
    created = await upstream.json();
  } catch {
    return fail('demo_unavailable', 503);
  }

  const expires = new Date(created.expiresAt);
  const sessionToken = await createDemoSession(created.userId, expires);
  const secure = secureCookies();
  const response = NextResponse.json({ redirect: `/${locale}/dashboard` });
  const options = { httpOnly: true, sameSite: 'lax' as const, path: '/', secure, expires };
  response.cookies.set(sessionCookieName(secure), sessionToken, options);
  response.cookies.set(ACTIVE_TENANT_COOKIE, created.tenantId, options);
  return response;
}
