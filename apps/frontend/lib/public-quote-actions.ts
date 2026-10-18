'use server';

/**
 * The client's accept/reject answer to a quote, posted from the public
 * portal (no session) to `POST /api/v1/public/invoices/:token/respond`.
 */
import { isPublicLinkSegment } from '@/lib/public-link';

const BACKEND_URL = (process.env.BACKEND_URL ?? 'http://localhost:3000').replace(/\/$/, '');

export type QuoteResponseResult = { ok: true } | { ok: false; error: 'invalid' | 'closed' | 'failed' };

export async function respondToQuote(
  token: string,
  response: 'accepted' | 'rejected',
  name: string,
  note: string
): Promise<QuoteResponseResult> {
  if (!isPublicLinkSegment(token) || !name.trim()) return { ok: false, error: 'invalid' };
  try {
    const res = await fetch(`${BACKEND_URL}/api/v1/public/invoices/${encodeURIComponent(token)}/respond`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ response, name: name.trim().slice(0, 120), note: note.trim().slice(0, 2000) || undefined }),
      cache: 'no-store',
      signal: AbortSignal.timeout(8000)
    });
    if (res.ok) return { ok: true };
    if (res.status === 409 || res.status === 404) return { ok: false, error: 'closed' };
    if (res.status === 400) return { ok: false, error: 'invalid' };
    return { ok: false, error: 'failed' };
  } catch {
    return { ok: false, error: 'failed' };
  }
}
