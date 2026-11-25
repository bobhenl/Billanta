'use server';

import { revalidatePath } from 'next/cache';
import { apiFetch, ApiError } from '@/lib/api-client';

export type ActionResult = { ok: true } | { ok: false; error: string };

async function post(path: string, body?: unknown): Promise<ActionResult> {
  try {
    await apiFetch(path, {
      method: 'POST',
      ...(body !== undefined && { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    });
    revalidatePath('/[locale]/(dashboard)', 'layout');
    return { ok: true };
  } catch (error) {
    if (error instanceof ApiError) {
      try {
        const parsed = JSON.parse(error.body) as { message?: unknown };
        if (typeof parsed.message === 'string') return { ok: false, error: parsed.message };
      } catch {
        // not JSON
      }
      return { ok: false, error: `HTTP ${error.status}` };
    }
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

const tx = (id: string, action: string) => `/api/v1/bank-reconciliation/transactions/${encodeURIComponent(id)}/${action}`;

/** Link a payment to an issued invoice; the backend also marks the invoice paid. */
export async function matchTransaction(id: string, invoiceId: string) {
  return post(tx(id, 'match'), { invoiceId });
}

export type RematchResult = { ok: true; checked: number; matched: number; linked: number } | { ok: false; error: string };

/** Runs auto-match again over unmatched payments; paid invoices are only linked, never changed. */
export async function rematchTransactions(): Promise<RematchResult> {
  try {
    const result = await apiFetch<{ checked: number; matched: number; linked: number }>('/api/v1/bank-reconciliation/rematch', { method: 'POST' });
    revalidatePath('/[locale]/(dashboard)', 'layout');
    return { ok: true, ...result };
  } catch (error) {
    return { ok: false, error: errorCode(error) };
  }
}

export type DraftFromPaymentResult = { ok: true; invoiceId: string } | { ok: false; error: string };

/** A pending_review draft from an unmatched incoming payment, linked to it. Never issued here. */
export async function draftInvoiceFromTransaction(id: string): Promise<DraftFromPaymentResult> {
  try {
    const result = await apiFetch<{ invoiceId: string }>(tx(id, 'draft-invoice'), { method: 'POST' });
    revalidatePath('/[locale]/(dashboard)', 'layout');
    return { ok: true, invoiceId: result.invoiceId };
  } catch (error) {
    return { ok: false, error: errorCode(error) };
  }
}

export async function ignoreTransaction(id: string) {
  return post(tx(id, 'ignore'));
}

export async function restoreTransaction(id: string) {
  return post(tx(id, 'restore'));
}

export interface BankConnection {
  id: string;
  provider: 'fio' | 'enable_banking' | 'paypal';
  status: 'pending' | 'active' | 'expired';
  label: string | null;
  accountNumber: string | null;
  bankName: string | null;
  bankCountry: string | null;
  consentExpiresAt: string | null;
  enabled: boolean;
  lastSyncedAt: string | null;
  lastError: string | null;
}

/** `pending`: Fio only moved its cursor this time, the payments come with the next sync. */
export type SyncResult = { ok: true; total: number; matched: number; pending: boolean } | { ok: false; error: string };

/** Backend error code (`{ error: "fio_token_format" }`) or the HTTP status. */
function errorCode(error: unknown): string {
  if (error instanceof ApiError) {
    try {
      const parsed = JSON.parse(error.body) as { error?: unknown; message?: unknown };
      // Nest puts the code in `error` ({ error: "fio_token_format" }) or, for a plain
      // `new ForbiddenException("two_factor_required")`, in `message` next to error "Forbidden".
      for (const value of [parsed.error, parsed.message]) {
        if (typeof value === 'string' && /^[a-z_]+$/.test(value)) return value;
      }
    } catch {
      // not JSON
    }
    return error.status === 403 ? 'forbidden' : `HTTP ${error.status}`;
  }
  return 'unavailable';
}

const connections = '/api/v1/bank-reconciliation/connections';

async function call(path: string, init: RequestInit): Promise<ActionResult> {
  try {
    await apiFetch(path, init);
    revalidatePath('/[locale]/(dashboard)', 'layout');
    return { ok: true };
  } catch (error) {
    return { ok: false, error: errorCode(error) };
  }
}

export async function connectFio(token: string, label: string): Promise<ActionResult> {
  return call(connections, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider: 'fio', token: token.trim(), label: label.trim() || null })
  });
}

/** PayPal REST app credentials; the backend checks them with one Transaction Search call. */
export async function connectPaypal(input: { clientId: string; secret: string; sandbox: boolean; label: string }): Promise<ActionResult> {
  return call(`${connections}/paypal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...input, clientId: input.clientId.trim(), secret: input.secret.trim(), label: input.label.trim() || null })
  });
}

export async function setBankConnectionEnabled(id: string, enabled: boolean): Promise<ActionResult> {
  return call(`${connections}/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled })
  });
}

export async function disconnectBank(id: string): Promise<ActionResult> {
  return call(`${connections}/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

/** Downloads new incoming payments now (the backend also does this every hour). */
export async function syncBankConnection(id: string): Promise<SyncResult> {
  try {
    const result = await apiFetch<{ total: number; matched: number; pending?: boolean }>(`${connections}/${encodeURIComponent(id)}/sync`, {
      method: 'POST'
    });
    revalidatePath('/[locale]/(dashboard)', 'layout');
    return { ok: true, total: result.total, matched: result.matched, pending: result.pending === true };
  } catch (error) {
    return { ok: false, error: errorCode(error) };
  }
}

export type BackfillResult =
  | { ok: true; total: number; matched: number; netUpdated: number }
  | { ok: false; error: string };

/** PayPal history from `from` ("2026-01-01"); the backend caps it at three years and never drafts invoices from it. */
export async function backfillBankConnection(id: string, from: string): Promise<BackfillResult> {
  try {
    const result = await apiFetch<{ total: number; matched: number; netUpdated?: number }>(
      `${connections}/${encodeURIComponent(id)}/backfill`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ from }) }
    );
    revalidatePath('/[locale]/(dashboard)', 'layout');
    return { ok: true, total: result.total, matched: result.matched, netUpdated: result.netUpdated ?? 0 };
  } catch (error) {
    return { ok: false, error: errorCode(error) };
  }
}

export interface Psd2Bank {
  name: string;
  country: string;
  logo: string | null;
  business: boolean;
}

export type Psd2BanksResult = { ok: true; banks: Psd2Bank[] } | { ok: false; error: string };

/** Banks reachable over PSD2 (Enable Banking) in a country. */
export async function listPsd2Banks(country: string): Promise<Psd2BanksResult> {
  try {
    const banks = await apiFetch<Psd2Bank[]>(`${connections}/psd2/banks?country=${encodeURIComponent(country)}`);
    return { ok: true, banks };
  } catch (error) {
    return { ok: false, error: errorCode(error) };
  }
}

export type StartPsd2Result = { ok: true; url: string } | { ok: false; error: string };

/** Starts consent at the bank; the caller then sends the browser to `url`. */
export async function startPsd2Connection(input: {
  bankName: string;
  country: string;
  psuType: 'business' | 'personal';
  label?: string;
  reconnectId?: string;
}): Promise<StartPsd2Result> {
  try {
    const { url } = await apiFetch<{ url: string }>(`${connections}/psd2/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...input, label: input.label?.trim() || null })
    });
    return { ok: true, url };
  } catch (error) {
    return { ok: false, error: errorCode(error) };
  }
}

/** The bank redirected back: exchange its code for the account session. */
export async function completePsd2Connection(code: string, state: string): Promise<ActionResult> {
  return call(`${connections}/psd2/complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, state })
  });
}
