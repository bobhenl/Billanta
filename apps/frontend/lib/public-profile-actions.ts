'use server';

import { headers } from 'next/headers';
import QRCode from 'qrcode';
import { generateSpaydString } from '@faktur/cz-compliance';
import type { BuyerFieldsValue } from '@/components/buyer-fields';

/**
 * Orders ("Objednat") and messages ("Kontaktovat") from the public company
 * profile `/p/:slug`, posted to `/api/v1/public/profiles/:slug/{orders,messages}`.
 * The visitor's IP is forwarded for the backend's per-visitor limits.
 */
const BACKEND_URL = (process.env.BACKEND_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const SLUG = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/;

export interface ProfileOrderInput {
  serviceId: string | null;
  quantity: number;
  customItems: { description: string; quantity: number }[];
  buyer: BuyerFieldsValue;
  note: string;
  website: string;
}

export interface OrderPayment {
  amount: number;
  currency: string;
  variableSymbol: string;
  iban: string | null;
  accountNumber: string | null;
  bic: string | null;
  recipient: string;
}

type Failure = 'invalid' | 'closed' | 'limit' | 'daily_cap' | 'unknown_service' | 'custom_items_disabled' | 'empty_order' | 'failed';

export type ProfileOrderResult = { ok: true; payment: OrderPayment | null; qrSvg: string | null } | { ok: false; error: Failure; fields?: Record<string, string> };
export type ProfileMessageResult = { ok: true } | { ok: false; error: Failure; fields?: Record<string, string> };

async function visitorHeaders(): Promise<Record<string, string>> {
  const h = await headers();
  // Same rule as lib/client-ip.ts: only the last X-Forwarded-For entry comes from our own proxy.
  const ip = h.get('x-forwarded-for')?.split(',').map((p) => p.trim()).filter(Boolean).pop() ?? h.get('x-real-ip') ?? '';
  return { 'Content-Type': 'application/json', ...(ip ? { 'x-guest-ip': ip } : {}) };
}

/** Maps the backend's error answer to a code the form translates, with per-field codes for a 400. */
async function failure(res: Response, fieldOf: (path: string) => string | null): Promise<{ ok: false; error: Failure; fields?: Record<string, string> }> {
  const data = (await res.json().catch(() => null)) as { error?: string; issues?: { path: string; message: string }[] } | null;
  if (res.status === 400) {
    if (data?.error === 'unknown_service' || data?.error === 'custom_items_disabled' || data?.error === 'empty_order') return { ok: false, error: data.error };
    const fields: Record<string, string> = {};
    for (const issue of data?.issues ?? []) {
      const key = fieldOf(issue.path);
      if (key && !fields[key]) fields[key] = issue.message;
    }
    return { ok: false, error: 'invalid', fields };
  }
  if (res.status === 404) return { ok: false, error: 'closed' };
  if (res.status === 429) return { ok: false, error: data?.error === 'daily_cap' ? 'daily_cap' : 'limit' };
  return { ok: false, error: 'failed' };
}

async function paymentQr(payment: OrderPayment): Promise<string | null> {
  if (!payment.iban) return null;
  try {
    const spayd = generateSpaydString({
      iban: payment.iban,
      bic: payment.bic ?? undefined,
      amount: payment.amount,
      currency: payment.currency,
      variableSymbol: payment.variableSymbol,
      message: payment.recipient.slice(0, 60)
    });
    return await QRCode.toString(spayd, { type: 'svg', margin: 1 });
  } catch {
    return null;
  }
}

export async function submitProfileOrder(slug: string, input: ProfileOrderInput): Promise<ProfileOrderResult> {
  if (!SLUG.test(slug)) return { ok: false, error: 'closed' };
  const b = input.buyer;
  try {
    const res = await fetch(`${BACKEND_URL}/api/v1/public/profiles/${encodeURIComponent(slug)}/orders`, {
      method: 'POST',
      headers: await visitorHeaders(),
      body: JSON.stringify({
        serviceId: input.serviceId || null,
        quantity: input.quantity,
        customItems: input.customItems.filter((i) => i.description.trim()),
        buyer: {
          isPerson: Boolean(b.isPerson),
          name: b.name,
          email: b.email || null,
          street: b.street,
          city: b.city,
          postalCode: b.postalCode,
          country: b.country,
          ico: b.isPerson ? null : b.ico || null,
          dic: b.isPerson ? null : b.dic || null
        },
        note: input.note || null,
        ...(input.website ? { website: input.website } : {})
      }),
      cache: 'no-store',
      signal: AbortSignal.timeout(30000)
    });
    if (res.ok) {
      const data = (await res.json().catch(() => null)) as { payment?: OrderPayment | null } | null;
      const payment = data?.payment ?? null;
      return { ok: true, payment, qrSvg: payment ? await paymentQr(payment) : null };
    }
    // `buyer.email` → `email`, `quantity` → `quantity`, `customItems.0.description` → `customItems`.
    return failure(res, (path) => (path.startsWith('buyer.') ? path.slice(6) : path.split('.')[0] || null));
  } catch {
    return { ok: false, error: 'failed' };
  }
}

export async function sendProfileMessage(slug: string, input: { name: string; email: string; message: string; serviceId: string | null; website: string }): Promise<ProfileMessageResult> {
  if (!SLUG.test(slug)) return { ok: false, error: 'closed' };
  try {
    const res = await fetch(`${BACKEND_URL}/api/v1/public/profiles/${encodeURIComponent(slug)}/messages`, {
      method: 'POST',
      headers: await visitorHeaders(),
      body: JSON.stringify({
        name: input.name,
        email: input.email,
        message: input.message,
        serviceId: input.serviceId || null,
        ...(input.website ? { website: input.website } : {})
      }),
      cache: 'no-store',
      signal: AbortSignal.timeout(15000)
    });
    if (res.ok) return { ok: true };
    return failure(res, (path) => path || null);
  } catch {
    return { ok: false, error: 'failed' };
  }
}
