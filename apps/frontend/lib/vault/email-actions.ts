'use server';

import { revalidatePath } from 'next/cache';
import { apiFetch } from '@/lib/api-client';
import { backendMessage } from '@/lib/action-error';
import type { BuyerField, OpenedInvoiceTexts } from './render-pdf';

type StoredBuyer = Partial<Record<BuyerField, string | null>>;

type Result<T> = { ok: true; value: T } | { ok: false; error: string };

async function call<T>(path: string, init?: RequestInit): Promise<Result<T>> {
  try {
    return { ok: true, value: await apiFetch<T>(path, init) };
  } catch (error) {
    return { ok: false, error: backendMessage(error) };
  }
}

export interface VaultEmail {
  id: string;
  invoiceId: string;
  invoiceNumber: string | null;
  /** `invoice`: the whole e-mail waits; `invoice_pdf`: the link went out, the PDF follows. */
  kind: 'invoice' | 'invoice_pdf';
  recipient: string;
  createdAt: string;
}

/** E-mails of encrypted documents waiting for a browser with the key (backend vault-email-queue.controller.ts). */
export async function fetchVaultEmails() {
  return call<{ items: VaultEmail[]; autoSendPdf: boolean }>('/api/v1/vault/invoices/emails');
}

/**
 * The stored texts of one document: envelopes the browser opens, never
 * plaintext of a sealed field. The buyer is the printed one: the
 * document's own copy where it has one, the contact otherwise.
 */
export async function fetchSealedTexts(invoiceId: string) {
  const result = await call<{
    invoice: { noteAbove: string | null; noteBelow: string | null; buyerSnapshot: StoredBuyer | null; buyerContactPerson: string | null };
    contact: StoredBuyer | null;
    items: { id: string; description: string }[];
  }>(`/api/v1/invoices/${encodeURIComponent(invoiceId)}/detail`);
  if (!result.ok) return result;
  const { invoice, contact, items } = result.value;
  const fields: BuyerField[] = ['legalName', 'addressStreet', 'addressCity', 'addressPostalCode'];
  const buyer = Object.fromEntries(fields.map((k) => [k, invoice.buyerSnapshot?.[k] ?? contact?.[k] ?? null])) as StoredBuyer;
  return {
    ok: true as const,
    value: {
      noteAbove: invoice.noteAbove,
      noteBelow: invoice.noteBelow,
      items: items.map((i) => ({ id: i.id, description: i.description })),
      buyer,
      buyerContactPerson: invoice.buyerContactPerson
    }
  };
}

/**
 * The fallback while browsers cannot render the PDF: the decrypted texts go
 * through once, the backend prints and sends them and stores nothing. Only
 * called after the member confirmed exactly that in the outbox dialog.
 */
export async function sendVaultEmailTexts(id: string, texts: OpenedInvoiceTexts) {
  const result = await call<{ sent: boolean }>(`/api/v1/vault/invoices/emails/${encodeURIComponent(id)}/send-texts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ texts, passThrough: true })
  });
  if (result.ok) revalidatePath('/[locale]/(dashboard)/invoices', 'layout');
  return result;
}

/** Sends a waiting e-mail with the PDF the browser rendered; the backend hands it to the mail provider and keeps nothing. */
export async function sendVaultEmailPdf(id: string, form: FormData) {
  const pdf = form.get('pdf');
  if (!(pdf instanceof Blob)) return { ok: false as const, error: 'pdf_required' };
  const body = new FormData();
  body.set('pdf', pdf, 'invoice.pdf');
  const result = await call<{ sent: boolean }>(`/api/v1/vault/invoices/emails/${encodeURIComponent(id)}/send`, { method: 'POST', body });
  if (result.ok) revalidatePath('/[locale]/(dashboard)/invoices', 'layout');
  return result;
}

export async function dismissVaultEmail(id: string) {
  return call<{ dismissed: boolean }>(`/api/v1/vault/invoices/emails/${encodeURIComponent(id)}/dismiss`, { method: 'POST' });
}
