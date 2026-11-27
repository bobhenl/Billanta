'use server';

import { revalidatePath } from 'next/cache';
import { isSealed, type VaultCategory, type VaultWrap } from '@faktur/cz-compliance';
import { apiFetch } from '@/lib/api-client';
import { backendMessage } from '@/lib/action-error';
import type { RekeyPayload } from './content';
import type { PlainContactBatch, sealContactBatch } from './contacts';
import type { Contact } from '@/app/[locale]/(dashboard)/invoices/new/types';
import type { PlainAttachment, PlainInvoice, VaultDocumentPage, VaultEmailMode, VaultStatus } from './types';

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

export async function updateVaultSettings(input: boolean | { sealNew?: boolean; emailMode?: VaultEmailMode; autoSendPdf?: boolean }) {
  const body = typeof input === 'boolean' ? { sealNew: input } : input;
  const result = await call<VaultStatus>('/api/v1/vault/settings', json('PATCH', body));
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

/**
 * Stores one document's texts re-encrypted under its own key. This runs on
 * the Next server, so the payload is ciphertext only: the document key
 * itself never leaves the browser (it goes into the link's #fragment).
 */
export async function storeRekeyedInvoice(invoiceId: string, payload: RekeyPayload) {
  // Only envelopes pass, in exactly these fields: nothing else can ride along to the server.
  const envelope = (v: unknown) => (isSealed(v) ? v : undefined);
  const body = {
    noteAbove: envelope(payload.noteAbove),
    noteBelow: envelope(payload.noteBelow),
    items: payload.items.flatMap((i) => (isSealed(i.description) ? [{ id: String(i.id), description: i.description }] : []))
  };
  const result = await call<{ rekeyed: number }>(`/api/v1/vault/invoices/${encodeURIComponent(invoiceId)}/rekey`, json('POST', body));
  if (result.ok) revalidatePath('/invoices', 'layout');
  return result;
}

export async function storeSealedInvoices(invoices: PlainInvoice[]) {
  const result = await call<{ sealed: number }>(
    '/api/v1/vault/invoices/seal',
    json('POST', { invoices: invoices.map(({ invoiceNumber: _n, documentKeyWrap: _w, ...rest }) => rest) })
  );
  if (result.ok) revalidatePath('/invoices', 'layout');
  return result;
}

/** Every contact as stored, for the customer typeahead to open and match here (Důvěrný režim). */
export async function fetchAllContacts() {
  return call<Contact[]>('/api/v1/contacts');
}

/** One batch of contacts (then document buyers) stored before "Kontakty" was on. Locked documents are left out. */
export async function fetchPlainContacts() {
  return call<PlainContactBatch>('/api/v1/vault/contacts/plain?limit=20');
}

/** Stores the envelopes the browser made. Only envelopes pass, in exactly the sealable fields. */
export async function storeSealedContacts(sealed: Awaited<ReturnType<typeof sealContactBatch>>) {
  const only = <T extends object>(o: T) => Object.fromEntries(Object.entries(o).filter(([k, v]) => k === 'id' || isSealed(v)));
  const body = {
    contacts: sealed.contacts.filter((c) => isSealed(c.legalName)).map(only),
    invoices: sealed.invoices.map((i) => ({ ...only({ id: i.id, buyerContactPerson: i.buyerContactPerson }), buyer: only(i.buyer) }))
  };
  const result = await call<{ contacts: number; invoices: number }>('/api/v1/vault/contacts/seal', json('POST', body));
  if (result.ok) revalidatePath('/', 'layout');
  return result;
}

/**
 * One page of documents for search, suggestions and the readable export.
 * The texts come back as stored; only the browser opens the envelopes.
 */
export async function fetchVaultDocuments(page: { after?: string | null; sealedOnly: boolean; from?: string; to?: string }) {
  const query = new URLSearchParams({ limit: '200', sealed_only: String(page.sealedOnly) });
  if (page.after) query.set('after', page.after);
  if (page.from) query.set('from', page.from);
  if (page.to) query.set('to', page.to);
  return call<VaultDocumentPage>(`/api/v1/vault/invoices/documents?${query}`);
}
