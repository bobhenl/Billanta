'use server';

import { headers } from 'next/headers';
import { isPublicLinkSegment } from '@/lib/public-link';

/**
 * A recipient's report of a suspicious document, posted from the public
 * portal (no session) to `POST /api/v1/public/invoices/:token/report`.
 * The visitor's IP is forwarded so the backend can rate-limit and count
 * distinct reporters (it trusts the header only from local addresses).
 */
const BACKEND_URL = (process.env.BACKEND_URL ?? 'http://localhost:3000').replace(/\/$/, '');

export type AbuseReason = 'fraud' | 'not_ordered' | 'spam' | 'other';
export type ReportResult = { ok: true } | { ok: false; error: 'invalid' | 'limit' | 'failed' };

export async function reportInvoice(token: string, reason: AbuseReason, message: string, email: string): Promise<ReportResult> {
  if (!isPublicLinkSegment(token) || !['fraud', 'not_ordered', 'spam', 'other'].includes(reason)) {
    return { ok: false, error: 'invalid' };
  }
  const h = await headers();
  // Same rule as lib/client-ip.ts: only the last X-Forwarded-For entry comes from our own proxy.
  const ip = h.get('x-forwarded-for')?.split(',').map((p) => p.trim()).filter(Boolean).pop() ?? h.get('x-real-ip') ?? '';
  try {
    const res = await fetch(`${BACKEND_URL}/api/v1/public/invoices/${encodeURIComponent(token)}/report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(ip ? { 'x-guest-ip': ip } : {}) },
      body: JSON.stringify({
        reason,
        message: message.trim().slice(0, 2000) || undefined,
        email: email.trim().slice(0, 200) || undefined
      }),
      cache: 'no-store',
      signal: AbortSignal.timeout(8000)
    });
    if (res.ok) return { ok: true };
    if (res.status === 429) return { ok: false, error: 'limit' };
    if (res.status === 400) return { ok: false, error: 'invalid' };
    return { ok: false, error: 'failed' };
  } catch {
    return { ok: false, error: 'failed' };
  }
}
