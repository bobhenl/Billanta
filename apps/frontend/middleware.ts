import createMiddleware from 'next-intl/middleware';
import { NextResponse, type NextRequest } from 'next/server';
import { routing } from './i18n/routing';
import { ATTRIBUTION_COOKIE, ATTRIBUTION_MAX_AGE, attributionFrom, serializeAttribution } from './lib/attribution';
import { JOIN_PATH, PROMO_CODE, PROMO_COOKIE } from './lib/promo';
import { REFERRAL_CODE, REFERRAL_COOKIE } from './lib/referral';
import { PROFILE_DOMAIN, SITE_URL } from './lib/site';

const intl = createMiddleware(routing);
/**
 * For a visitor who sends no cookie at all. next-intl would otherwise set
 * `NEXT_LOCALE` whenever the page's locale differs from Accept-Language,
 * and on every page for a client that sends none (most crawlers). A shared
 * cache does not store a response that sets a cookie, and one that did
 * would hand that cookie to everyone, so those pages could never be served
 * from a CDN. The cookie only steers the `/` redirect; the language
 * switcher's Link writes it on the client, and a visitor who carries any
 * cookie still gets it from `intl` above.
 */
const intlNoCookie = createMiddleware({ ...routing, localeCookie: false });
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

/**
 * First touch only: the utm tags or the external site that first brought
 * the visitor, saved with the account at signup (lib/attribution.ts).
 */
function rememberAttribution(request: NextRequest, response: NextResponse) {
  if (request.cookies.has(ATTRIBUTION_COOKIE)) return response;
  const own = [request.nextUrl.hostname.toLowerCase(), new URL(SITE_URL).hostname.toLowerCase()];
  const attribution = attributionFrom(request.nextUrl, request.headers.get('referer'), own);
  if (!attribution) return response;
  response.cookies.set(ATTRIBUTION_COOKIE, serializeAttribution(attribution), {
    maxAge: ATTRIBUTION_MAX_AGE,
    path: '/',
    sameSite: 'lax',
    httpOnly: true,
    secure: request.nextUrl.protocol === 'https:'
  });
  return response;
}

/**
 * `?promo=` on any page, or a `/join/CODE` link: remember the code for the
 * company the visitor is about to found. Unlike an invite, the latest link
 * wins: it is the event or creator the visitor just came from.
 */
function rememberPromo(request: NextRequest, response: NextResponse) {
  const promo = (request.nextUrl.pathname.match(JOIN_PATH)?.[2] ?? request.nextUrl.searchParams.get('promo'))?.trim();
  if (!promo || !PROMO_CODE.test(promo)) return response;
  const code = promo.toUpperCase();
  if (request.cookies.get(PROMO_COOKIE)?.value === code) return response;
  response.cookies.set(PROMO_COOKIE, code, {
    maxAge: 60 * 60 * 24 * 30,
    path: '/',
    sameSite: 'lax',
    httpOnly: true,
    secure: request.nextUrl.protocol === 'https:'
  });
  return response;
}

/**
 * A poster or QR code points to `/join/CODE` without a locale. When the
 * visitor has never picked a language, mark the locale redirect so the join
 * page may switch to the code's own language (a Slovak event's code opens in
 * Slovak even on an English phone).
 */
function markJoinLocale(request: NextRequest, response: NextResponse) {
  const match = request.nextUrl.pathname.match(JOIN_PATH);
  const location = response.headers.get('location');
  if (!match || match[1] || !location || request.cookies.has('NEXT_LOCALE')) return response;
  const url = new URL(location, request.url);
  url.searchParams.set('auto', '1');
  response.headers.set('location', url.toString());
  return response;
}

/**
 * A response that sets a cookie (the referral or promo code, the attribution, the locale for a visitor
 * who has cookies) must never reach a shared cache, whatever Next would
 * say about the page. Next keeps a Cache-Control it finds on the response,
 * so this wins over the page's ISR one.
 */
function privateIfSettingCookies(response: NextResponse) {
  if (response.headers.has('set-cookie')) response.headers.set('Cache-Control', 'private, no-store');
  return response;
}

export default function middleware(request: NextRequest) {
  const locale = request.headers.get('cookie')?.trim() ? intl : intlNoCookie;
  const response = profileRewrite(request) ?? markJoinLocale(request, locale(request));
  return privateIfSettingCookies(rememberAttribution(request, rememberPromo(request, rememberReferral(request, response))));
}

export const config = {
  // Match all paths except Next.js internals, API routes, the iframe
  // widgets (their own root layout without a locale: app/embed) and files
  // with an extension (static assets).
  matcher: ['/((?!api|trpc|_next|_vercel|og/|embed/|.*\\..*).*)']
};
