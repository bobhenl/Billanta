/** Server-only: the demo's session cookies, shared by the /api/demo routes. */
import { cookies } from 'next/headers';
import type { NextResponse } from 'next/server';
import { createDemoSession, deleteSessionByToken, sessionCookieName } from '@/auth';
import { ACTIVE_TENANT_COOKIE } from '@/lib/api-client';
import { secureCookies } from '@/lib/demo';

/** Holds the one-time "take my demo work along" token through sign-up (/api/demo/transfer). */
export const DEMO_TRANSFER_COOKIE = 'billanta_demo_transfer';

/**
 * Points the browser at a (new) demo session: the start route after creating
 * a company, the role route after switching to a colleague. The session the
 * browser had before is deleted, so switching back and forth leaves no
 * stray sessions behind.
 */
export async function openDemoSession(response: NextResponse, userId: string, tenantId: string, expires: Date) {
  const secure = secureCookies();
  const name = sessionCookieName(secure);
  const previous = (await cookies()).get(name)?.value;
  const sessionToken = await createDemoSession(userId, expires);
  if (previous) await deleteSessionByToken(previous).catch(() => undefined);
  const options = { httpOnly: true, sameSite: 'lax' as const, path: '/', secure, expires };
  response.cookies.set(name, sessionToken, options);
  response.cookies.set(ACTIVE_TENANT_COOKIE, tenantId, options);
}

/** Drops the demo session and its cookies (leaving the demo, or handing over to sign-up). */
export async function closeDemoSession(response: NextResponse) {
  const secure = secureCookies();
  const name = sessionCookieName(secure);
  const token = (await cookies()).get(name)?.value;
  if (token) await deleteSessionByToken(token);
  // A `__Secure-` cookie is only overwritten by one that is itself Secure.
  const expired = { httpOnly: true, sameSite: 'lax' as const, path: '/', secure, maxAge: 0 };
  response.cookies.set(name, '', expired);
  response.cookies.set(ACTIVE_TENANT_COOKIE, '', expired);
}
