'use server';

/**
 * "Pay by card" on the public invoice page: asks the backend for a Stripe
 * Checkout session on the supplier's own Stripe account
 * (`POST /api/v1/public/invoices/:token/card-checkout`) and returns its URL.
 */
const BACKEND_URL = (process.env.BACKEND_URL ?? 'http://localhost:3000').replace(/\/$/, '');

export type CardCheckoutResult = { ok: true; url: string } | { ok: false; error: 'unavailable' | 'failed' };

export async function startCardCheckout(token: string, locale: string): Promise<CardCheckoutResult> {
  if (!/^[0-9a-f-]{36}$/i.test(token)) return { ok: false, error: 'unavailable' };
  try {
    const res = await fetch(`${BACKEND_URL}/api/v1/public/invoices/${encodeURIComponent(token)}/card-checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ locale }),
      cache: 'no-store',
      signal: AbortSignal.timeout(15000)
    });
    if (res.status === 404 || res.status === 400) return { ok: false, error: 'unavailable' };
    if (!res.ok) return { ok: false, error: 'failed' };
    const { url } = (await res.json()) as { url?: string };
    // Only ever send the payer to Stripe's own checkout pages.
    if (!url || !url.startsWith('https://checkout.stripe.com/')) return { ok: false, error: 'failed' };
    return { ok: true, url };
  } catch {
    return { ok: false, error: 'failed' };
  }
}
