import { NextResponse } from 'next/server';
import { clientIp } from '@/lib/client-ip';

const BACKEND_URL = (process.env.BACKEND_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const SLUG = /^[a-z0-9-]{1,60}$/;

/**
 * `/partneri/go/:slug`: counts the click in the backend (bots and repeats
 * excluded there, per visitor IP passed as `x-guest-ip`) and redirects to
 * the partner. Unknown or inactive partners land on the directory instead.
 * robots.txt disallows the path, and links to it carry rel="sponsored".
 */
export async function GET(request: Request, { params }: { params: Promise<{ locale: string; slug: string }> }) {
  const { locale, slug } = await params;
  const fallback = new URL(`/${locale}/partneri`, request.url);
  if (!SLUG.test(slug)) return NextResponse.redirect(fallback, 302);
  const ip = clientIp(request);
  try {
    const upstream = await fetch(`${BACKEND_URL}/api/v1/public/partners/${slug}/click`, {
      method: 'POST',
      headers: { ...(ip ? { 'x-guest-ip': ip } : {}), 'x-guest-ua': request.headers.get('user-agent') ?? '' },
      cache: 'no-store',
      signal: AbortSignal.timeout(3000)
    });
    if (!upstream.ok) return NextResponse.redirect(fallback, 302);
    const { url } = (await upstream.json()) as { url?: string };
    if (!url || !/^https?:\/\//i.test(url)) return NextResponse.redirect(fallback, 302);
    const res = NextResponse.redirect(url, 302);
    res.headers.set('X-Robots-Tag', 'noindex, nofollow');
    res.headers.set('Cache-Control', 'no-store');
    return res;
  } catch {
    return NextResponse.redirect(fallback, 302);
  }
}
