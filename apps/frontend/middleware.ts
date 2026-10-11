import createMiddleware from 'next-intl/middleware';
import { NextResponse, type NextRequest } from 'next/server';
import { routing } from './i18n/routing';
import { PROFILE_DOMAIN } from './lib/site';

const intl = createMiddleware(routing);
const SLUG = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/;
const NOT_PROFILES = new Set(['www', 'app', 'api']);

/**
 * `<slug>.<NEXT_PUBLIC_PROFILE_DOMAIN>` → the public company profile
 * (`app/[locale]/p/[slug]`). Only the root (optionally with a locale) is
 * rewritten; any other path on a profile subdomain goes to the main site.
 */
function profileRewrite(request: NextRequest) {
  if (!PROFILE_DOMAIN) return null;
  const host = (request.headers.get('host') ?? '').split(':')[0]!.toLowerCase();
  if (!host.endsWith(`.${PROFILE_DOMAIN}`)) return null;
  const slug = host.slice(0, -PROFILE_DOMAIN.length - 1);
  if (!SLUG.test(slug) || NOT_PROFILES.has(slug)) return null;
  const match = request.nextUrl.pathname.match(/^\/(?:(cs|sk|en)\/?)?$/);
  if (!match) return null;
  const url = request.nextUrl.clone();
  url.pathname = `/${match[1] ?? routing.defaultLocale}/p/${slug}`;
  return NextResponse.rewrite(url);
}

export default function middleware(request: NextRequest) {
  return profileRewrite(request) ?? intl(request);
}

export const config = {
  // Match all paths except Next.js internals, API routes, and files with
  // an extension (static assets).
  matcher: ['/((?!api|trpc|_next|_vercel|og/|.*\\..*).*)']
};
