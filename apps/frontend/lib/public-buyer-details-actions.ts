'use server';

import { headers } from 'next/headers';

/**
 * The customer's billing details, posted from the public page `/d/:token`
 * to `POST /api/v1/public/buyer-details/:token`. The visitor's IP is
 * forwarded for the backend's rate limit (trusted only from local addresses).
 */
const BACKEND_URL = (process.env.BACKEND_URL ?? 'http://localhost:3000').replace(/\/$/, '');

export interface BuyerDetailsInput {
  isPerson: boolean;
  name: string;
  email: string;
  street: string;
  city: string;
  postalCode: string;
  country: string;
  ico: string;
  dic: string;
}

export type BuyerDetailsResult =
  | { ok: true }
  | { ok: false; error: 'invalid' | 'closed' | 'submitted' | 'limit' | 'failed'; fields?: Record<string, string> };

export async function submitBuyerDetails(token: string, input: BuyerDetailsInput): Promise<BuyerDetailsResult> {
  if (!/^[0-9a-f-]{36}$/i.test(token)) return { ok: false, error: 'closed' };
  const h = await headers();
  // Same rule as lib/client-ip.ts: only the last X-Forwarded-For entry comes from our own proxy.
  const ip = h.get('x-forwarded-for')?.split(',').map((p) => p.trim()).filter(Boolean).pop() ?? h.get('x-real-ip') ?? '';
  try {
    const res = await fetch(`${BACKEND_URL}/api/v1/public/buyer-details/${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(ip ? { 'x-guest-ip': ip } : {}) },
      body: JSON.stringify({
        isPerson: Boolean(input.isPerson),
        name: input.name,
        email: input.email || null,
        street: input.street,
        city: input.city,
        postalCode: input.postalCode,
        country: input.country,
        ico: input.isPerson ? null : input.ico || null,
        dic: input.isPerson ? null : input.dic || null
      }),
      cache: 'no-store',
      signal: AbortSignal.timeout(30000)
    });
    if (res.ok) return { ok: true };
    if (res.status === 400) {
      const data = (await res.json().catch(() => null)) as { issues?: { path: string; message: string }[] } | null;
      const fields: Record<string, string> = {};
      for (const issue of data?.issues ?? []) if (issue.path && !fields[issue.path]) fields[issue.path] = issue.message;
      return { ok: false, error: 'invalid', fields };
    }
    if (res.status === 409) {
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      return { ok: false, error: data?.error === 'submitted' ? 'submitted' : 'closed' };
    }
    if (res.status === 404) return { ok: false, error: 'closed' };
    if (res.status === 429) return { ok: false, error: 'limit' };
    return { ok: false, error: 'failed' };
  } catch {
    return { ok: false, error: 'failed' };
  }
}
