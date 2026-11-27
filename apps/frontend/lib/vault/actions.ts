'use server';

import { revalidatePath } from 'next/cache';
import type { VaultCategory, VaultWrap } from '@faktur/cz-compliance';
import { apiFetch } from '@/lib/api-client';
import { backendMessage } from '@/lib/action-error';
import type { PlainAttachment, PlainInvoice, VaultStatus } from './types';

type Result<T> = { ok: true; value: T } | { ok: false; error: string };

async function call<T>(path: string, init?: RequestInit): Promise<Result<T>> {
  try {
    return { ok: true, value: await apiFetch<T>(path, init) };
  } catch (error) {
    return { ok: false, error: backendMessage(error) };
  }
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body)
});

/** Everything here carries only wrapped keys and ciphertext; the browser does the crypto. */
export async function enableVault(input: { keyCheck: string; password: VaultWrap; recovery: VaultWrap; categories: VaultCategory[] }) {
  const result = await call<VaultStatus>('/api/v1/vault/enable', json('POST', { ...input, acknowledged: true }));
  if (result.ok) revalidatePath('/', 'layout');
  return result;
}

export async function addVaultWrap(wrap: VaultWrap & { credentialId?: string; label?: string | null }) {
  const result = await call<VaultStatus>('/api/v1/vault/me/wraps', json('POST', { wrap }));
  if (result.ok) revalidatePath('/', 'layout');
  return result;
}

export async function removeVaultWrap(id: string) {
  const result = await call<VaultStatus>(`/api/v1/vault/me/wraps/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (result.ok) revalidatePath('/', 'layout');
  return result;
}

export async function replaceRecoveryWrap(recovery: VaultWrap) {
  const result = await call<VaultStatus>('/api/v1/vault/recovery', json('PUT', { recovery }));
  if (result.ok) revalidatePath('/', 'layout');
  return result;
}

export async function updateVaultSettings(sealNew: boolean) {
  const result = await call<VaultStatus>('/api/v1/vault/settings', json('PATCH', { sealNew }));
  if (result.ok) revalidatePath('/', 'layout');
  return result;
}

/** Adds or drops categories; whatever is already encrypted stays encrypted. */
export async function updateVaultCategories(categories: VaultCategory[]) {
  const result = await call<VaultStatus>('/api/v1/vault/settings', json('PATCH', { categories }));
  if (result.ok) revalidatePath('/', 'layout');
  return result;
}

/** One batch of files stored before "Přílohy a účtenky" was on (locked documents left out). */
export async function fetchPlainAttachments() {
  return call<{ remaining: number; files: PlainAttachment[] }>('/api/v1/vault/attachments/plain?limit=10');
}

/** One batch of documents with plain texts left: the whole company, one customer, or one document. */
export async function fetchPlainInvoices(scope: { invoiceId?: string; contactId?: string }) {
  const query = new URLSearchParams({ limit: '20' });
  if (scope.invoiceId) query.set('invoice_id', scope.invoiceId);
  if (scope.contactId) query.set('contact_id', scope.contactId);
  return call<{ remaining: number; invoices: PlainInvoice[] }>(`/api/v1/vault/invoices/plain?${query}`);
}

export async function storeSealedInvoices(invoices: PlainInvoice[]) {
  const result = await call<{ sealed: number }>('/api/v1/vault/invoices/seal', json('POST', { invoices: invoices.map(({ invoiceNumber: _n, ...rest }) => rest) }));
  if (result.ok) revalidatePath('/invoices', 'layout');
  return result;
}
