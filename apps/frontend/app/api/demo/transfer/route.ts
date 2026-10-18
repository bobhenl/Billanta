import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { routing } from '@/i18n/routing';
import { apiFetch } from '@/lib/api-client';
import { sameOrigin, secureCookies } from '@/lib/demo';
import { DEMO_TRANSFER_COOKIE, closeDemoSession } from '@/lib/demo-session';
import { fetchTenant } from '@/lib/tenant';

/**
 * "Create an account and take my work along": the backend issues a one-time
 * token for what the visitor made in the demo, the browser keeps it in an
 * httpOnly cookie through sign-up, and the dashboard of the new account
 * offers to bring it in (DemoTransferClaim). The demo session ends here, so
 * the sign-up form starts with a clean browser.
 */
export async function POST(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  if (!(await auth())?.isDemo) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const body = (await request.json().catch(() => null)) as { locale?: unknown } | null;
  const locale = routing.locales.find((l) => l === body?.locale) ?? routing.defaultLocale;

  // Without a token the visitor still goes on to sign up, just without the hand-over.
  const [issued, tenant] = await Promise.all([
    apiFetch<{ token: string }>('/api/v1/demo/transfer', { method: 'POST' }).catch(() => null),
    fetchTenant().catch(() => null)
  ]);

  const response = NextResponse.json({ redirect: `/${locale}/signup` });
  if (issued && tenant?.demoExpiresAt) {
    response.cookies.set(DEMO_TRANSFER_COOKIE, issued.token, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      secure: secureCookies(),
      // The demo's documents are gone after it expires, and so is the point of the token.
      expires: new Date(tenant.demoExpiresAt)
    });
  }
  await closeDemoSession(response);
  return response;
}
