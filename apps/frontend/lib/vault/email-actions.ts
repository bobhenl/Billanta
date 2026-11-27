'use server';

import { revalidatePath } from 'next/cache';
import { apiFetch } from '@/lib/api-client';
import { backendMessage } from '@/lib/action-error';

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
