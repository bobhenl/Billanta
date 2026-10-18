'use server';

import { revalidatePath } from 'next/cache';
import { getTranslations } from 'next-intl/server';
import { apiFetch, ApiError } from '@/lib/api-client';

/**
 * Server actions behind the invoice detail page and the list's row menu.
 * Each returns a small result object instead of throwing, so the client can
 * show a toast with the backend's reason.
 */

export type ActionResult<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

async function run<T>(path: string, init: RequestInit = { method: 'POST' }): Promise<ActionResult<T>> {
  try {
    const data = await apiFetch<T>(path, init);
    revalidatePath('/[locale]/(dashboard)/invoices', 'layout');
    return { ok: true, data };
  } catch (error) {
    return { ok: false, error: await backendMessage(error) };
  }
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body)
});

export async function issueInvoice(id: string) {
  return run<{ id: string; invoiceNumber: string }>(`/api/v1/invoices/${id}/issue`);
}

export async function sendInvoice(id: string) {
  return run<unknown>(`/api/v1/invoices/${id}/send`);
}

export async function sendReminder(id: string) {
  return run<unknown>(`/api/v1/invoices/${id}/remind`);
}

export async function markInvoicePaid(id: string, paidAt?: string, amount?: number, net: { fee?: number; receivedCzk?: number } = {}) {
  return run<unknown>(
    `/api/v1/invoices/${id}/mark-paid`,
    json('POST', {
      ...(paidAt ? { paid_at: paidAt } : {}),
      ...(amount ? { amount } : {}),
      ...(net.fee ? { fee: net.fee } : {}),
      ...(net.receivedCzk ? { received_czk: net.receivedCzk } : {})
    })
  );
}

export async function markInvoiceUnpaid(id: string) {
  return run<unknown>(`/api/v1/invoices/${id}/mark-unpaid`);
}

export async function cancelInvoice(id: string) {
  return run<unknown>(`/api/v1/invoices/${id}/cancel`);
}

/** New secret client link; the old /i/{token} address stops working. */
export async function rotateInvoiceLink(id: string) {
  return run<{ id: string; publicToken: string }>(`/api/v1/invoices/${id}/public-link/rotate`);
}

/** Sends the draft to the customer to fill in their own billing details (a fresh /d/{token} link each time). */
export async function requestBuyerDetails(
  id: string,
  email: string,
  autoIssue: boolean,
  required?: ('email' | 'phone' | 'ico' | 'dic')[],
  saveAsDefault = false
) {
  return run<{ token: string; url: string; emailed: boolean; autoIssue: boolean }>(
    `/api/v1/invoices/${id}/buyer-details-request`,
    json('POST', { email: email.trim() || undefined, autoIssue, required, saveAsDefault })
  );
}

/** Closes the request; the customer's link stops working at once. */
export async function cancelBuyerDetails(id: string) {
  return run<unknown>(`/api/v1/invoices/${id}/buyer-details-request`, { method: 'DELETE' });
}

export async function convertInvoice(id: string, to: 'invoice' | 'proforma' | 'credit_note') {
  return run<{ id: string }>(`/api/v1/invoices/${id}/convert`, json('POST', { to }));
}

export async function deleteInvoice(id: string) {
  return run<unknown>(`/api/v1/invoices/${id}`, { method: 'DELETE' });
}

export async function saveInvoiceAsTemplate(id: string, name: string) {
  return run<{ id: string }>(`/api/v1/invoice-templates/from-invoice/${id}`, json('POST', { name }));
}

/** NestJS error bodies are `{ message: string | string[] }`; surface that text. */
const SEND_BLOCK_CODES = ['EMAIL_DAILY_LIMIT', 'EMAIL_PAUSED', 'ACCOUNT_SUSPENDED'] as const;

async function backendMessage(error: unknown): Promise<string> {
  if (error instanceof ApiError) {
    try {
      const body = JSON.parse(error.body || '{}') as { message?: unknown; error?: unknown; code?: unknown };
      // Anti-abuse blocks from the sending guard carry a stable code; show a translated reason.
      const code = SEND_BLOCK_CODES.find((c) => c === body.code);
      if (code) return (await getTranslations('invoices.sendBlocked'))(code);
      const message = Array.isArray(body.message) ? body.message.join(', ') : body.message;
      if (typeof message === 'string' && message) return message;
      if (typeof body.error === 'string') return body.error;
    } catch {
      // not JSON
    }
    return `HTTP ${error.status}`;
  }
  return String(error);
}
