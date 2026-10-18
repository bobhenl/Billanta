import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { auth, deleteSessionByToken, sessionCookieName } from '@/auth';
import { routing } from '@/i18n/routing';
import { ACTIVE_TENANT_COOKIE } from '@/lib/api-client';
import { sameOrigin, secureCookies } from '@/lib/demo';

/** Where a visitor may go after leaving a demo; anything else would be an open redirect. */
const NEXT_PATHS = ['/signup', '/demo'] as const;

/**
 * Leaves a demo: drops the session and the cookies. The company itself stays
 * until the cleanup job deletes it. Only a demo session is ever deleted here;
 * a real one is left alone.
 */
export async function POST(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const body = (await request.json().catch(() => null)) as { next?: unknown; locale?: unknown } | null;
  const locale = routing.locales.find((l) => l === body?.locale) ?? routing.defaultLocale;
  const next = NEXT_PATHS.find((p) => p === body?.next) ?? '/demo';

  const response = NextResponse.json({ redirect: `/${locale}${next}` });
  const secure = secureCookies();
  const cookieName = sessionCookieName(secure);
  const token = (await cookies()).get(cookieName)?.value;
  if (token && (await auth())?.isDemo) {
    await deleteSessionByToken(token);
    // A `__Secure-` cookie is only overwritten by one that is itself Secure.
    const expired = { httpOnly: true, sameSite: 'lax' as const, path: '/', secure, maxAge: 0 };
    response.cookies.set(cookieName, '', expired);
    response.cookies.set(ACTIVE_TENANT_COOKIE, '', expired);
  }
  return response;
}
