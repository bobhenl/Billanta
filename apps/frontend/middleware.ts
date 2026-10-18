import createMiddleware from 'next-intl/middleware';
import { NextResponse, type NextRequest } from 'next/server';
import { routing } from './i18n/routing';
import { REFERRAL_CODE, REFERRAL_COOKIE } from './lib/referral';
import { PROFILE_DOMAIN, SITE_URL } from './lib/site';

const intl = createMiddleware(routing);
const SLUG = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/;
const NOT_PROFILES = new Set(['www', 'app', 'api']);

/**
 * `<slug>.<NEXT_PUBLIC_PROFILE_DOMAIN>` → the public company profile
 * (`app/[locale]/p/[slug]`). Only the root (optionally with a locale) is
 * rewritten. Any other path on a profile subdomain redirects to the main
 * site, so `novak.<domain>/cs/login` can't pass for a page of that company.
 */
function profileRewrite(request: NextRequest) {
  if (!PROFILE_DOMAIN) return null;
  const host = (request.headers.get('host') ?? '').split(':')[0]!.toLowerCase();
  if (!host.endsWith(`.${PROFILE_DOMAIN}`)) return null;
  const slug = host.slice(0, -PROFILE_DOMAIN.length - 1);
  if (!SLUG.test(slug) || NOT_PROFILES.has(slug)) return null;
  const match = request.nextUrl.pathname.match(/^\/(?:(cs|sk|en)\/?)?$/);
  if (!match) return NextResponse.redirect(new URL(request.nextUrl.pathname + request.nextUrl.search, SITE_URL), 308);
  const url = request.nextUrl.clone();
  url.pathname = `/${match[1] ?? routing.defaultLocale}/p/${slug}`;
  return NextResponse.rewrite(url);
}

/** `?ref=` on any page: remember who invited the visitor (first invite wins). */
function rememberReferral(request: NextRequest, response: NextResponse) {
  const ref = request.nextUrl.searchParams.get('ref');
  if (!ref || !REFERRAL_CODE.test(ref) || request.cookies.has(REFERRAL_COOKIE)) return response;
  response.cookies.set(REFERRAL_COOKIE, ref.toUpperCase(), {
    maxAge: 60 * 60 * 24 * 30,
    path: '/',
    sameSite: 'lax',
    httpOnly: true,
    secure: request.nextUrl.protocol === 'https:'
  });
  return response;
}

export default function middleware(request: NextRequest) {
  return rememberReferral(request, profileRewrite(request) ?? intl(request));
}

export const config = {
  // Match all paths except Next.js internals, API routes, and files with
  // an extension (static assets).
  matcher: ['/((?!api|trpc|_next|_vercel|og/|.*\\..*).*)']
};
