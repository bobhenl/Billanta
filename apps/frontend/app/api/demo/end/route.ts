import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { routing } from '@/i18n/routing';
import { sameOrigin } from '@/lib/demo';
import { closeDemoSession } from '@/lib/demo-session';

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
  if ((await auth())?.isDemo) await closeDemoSession(response);
  return response;
}
