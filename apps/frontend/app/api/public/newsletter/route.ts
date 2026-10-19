import { NextResponse } from 'next/server';
import { getTranslations } from 'next-intl/server';
import { routing } from '@/i18n/routing';
import { clientIp } from '@/lib/client-ip';
import { isNewsletterTopic } from '@/lib/newsletter';

const BACKEND_URL = (process.env.BACKEND_URL ?? 'http://localhost:3000').replace(/\/$/, '');

/**
 * Newsletter signup from the public pages. Starts the double opt-in only:
 * the backend sends a confirmation e-mail and nothing else until it is
 * confirmed. The consent wording stored as evidence comes from our own
 * messages for the visitor's locale, never from the request body, so it is
 * exactly what the form showed. Rate-limited per visitor by the backend.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || body.consent !== true) return NextResponse.json({ error: 'consent_required' }, { status: 400 });
  const locale = (routing.locales as readonly string[]).includes(String(body.locale)) ? String(body.locale) : routing.defaultLocale;
  const email = typeof body.email === 'string' ? body.email.trim() : '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 320) return NextResponse.json({ error: 'invalid_email' }, { status: 400 });
  const topics = Array.isArray(body.topics) ? body.topics.filter(isNewsletterTopic) : [];
  if (!topics.length) return NextResponse.json({ error: 'no_topics' }, { status: 400 });
  const t = await getTranslations({ locale, namespace: 'newsletter.signup' });
  const ip = clientIp(request);
  try {
    const upstream = await fetch(`${BACKEND_URL}/api/v1/public/newsletter/subscribe`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(ip ? { 'x-guest-ip': ip } : {}) },
      body: JSON.stringify({
        email,
        locale,
        country: body.country === 'SK' ? 'SK' : 'CZ',
        topics,
        source: typeof body.source === 'string' ? body.source : 'other',
        consentText: t('consent'),
        website: typeof body.website === 'string' ? body.website.slice(0, 200) : undefined
      }),
      cache: 'no-store',
      signal: AbortSignal.timeout(10000)
    });
    if (upstream.status === 429) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
    if (upstream.status === 400) return NextResponse.json({ error: 'invalid_email' }, { status: 400 });
    if (!upstream.ok) return NextResponse.json({ error: 'failed' }, { status: 502 });
    return NextResponse.json({ ok: true }, { status: 202 });
  } catch {
    return NextResponse.json({ error: 'failed' }, { status: 502 });
  }
}
