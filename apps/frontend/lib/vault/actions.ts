'use server';

import { revalidatePath } from 'next/cache';
import { isSealed, type VaultCategory, type VaultWrap } from '@faktur/cz-compliance';
import { apiFetch } from '@/lib/api-client';
import { backendMessage } from '@/lib/action-error';
import type { RekeyPayload } from './content';
import type { PlainContactBatch, sealContactBatch } from './contacts';
import type { PlainAmountsDocument, sealPlainAmounts } from './amounts';
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

export async function addVaultWrap(wrap: VaultWrap & { credentialId?: string; label?: string | null; publicKey?: string; publicKeyAlg?: -7 | -257 }) {
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
    items: payload.items.flatMap((i) => (isSealed(i.description) ? [{ id: String(i.id), description: i.description }] : [])),
    buyer: payload.buyer
      ? {
          legalName: envelope(payload.buyer.legalName),
          addressStreet: envelope(payload.buyer.addressStreet),
          addressCity: envelope(payload.buyer.addressCity),
          addressPostalCode: envelope(payload.buyer.addressPostalCode)
        }
      : undefined,
    buyerContactPerson: envelope(payload.buyerContactPerson)
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

/** Documents whose amounts are still plain (not locked), with what was paid. */
export async function fetchPlainAmounts() {
  return call<{ remaining: number; invoices: PlainAmountsDocument[] }>('/api/v1/vault/invoices/plain-amounts?limit=20');
}

/** Stores the amounts envelopes; the server writes the placeholder into the plain columns itself. */
export async function storeSealedAmounts(invoices: Awaited<ReturnType<typeof sealPlainAmounts>>[]) {
  const body = {
    invoices: invoices
      .filter((i) => isSealed(i.encAmounts) && i.items.every((it) => isSealed(it.encAmounts)))
      .map((i) => ({
        id: i.id,
        encAmounts: i.encAmounts,
        items: i.items.map((it) => ({ id: it.id, encAmounts: it.encAmounts })),
        ...('encPaid' in i && isSealed(i.encPaid) ? { encPaid: i.encPaid } : {})
      }))
  };
  if (!body.invoices.length) return { ok: true as const, value: { sealed: 0, skipped: 0 } };
  const result = await call<{ sealed: number; skipped: number }>('/api/v1/vault/invoices/seal-amounts', json('POST', body));
  if (result.ok) revalidatePath('/', 'layout');
  return result;
}

/** One payment of a document with sealed amounts, as stored: the sums are an envelope. */
export interface SealedPaymentRow {
  id: string;
  paidAt: string | null;
  variableSymbol: string | null;
  bankTransactionId: string | null;
  encAmount: string;
  createdAt: string;
}

export type SealedVerdict = 'unpaid' | 'partly_paid' | 'paid';

export async function fetchSealedPayments(invoiceId: string) {
  return call<SealedPaymentRow[]>(`/api/v1/invoices/${invoiceId}/sealed-payments`);
}

/** Only the envelope leaves the tab; `state` is what this browser computed from the opened total. */
export async function addSealedPayment(
  invoiceId: string,
  input: { encAmount: string; paidAt: string; bankTransactionId?: string | null; state: Exclude<SealedVerdict, 'unpaid'> }
) {
  if (!isSealed(input.encAmount)) return { ok: false as const, error: 'amounts_plaintext' };
  const result = await call<unknown>(
    `/api/v1/invoices/${invoiceId}/sealed-payments`,
    json('POST', { enc_amount: input.encAmount, paid_at: input.paidAt, bank_transaction_id: input.bankTransactionId ?? null, state: input.state })
  );
  if (result.ok) revalidatePath('/', 'layout');
  return result;
}

export async function deleteSealedPayment(invoiceId: string, paymentId: string, state: SealedVerdict) {
  const result = await call<unknown>(`/api/v1/invoices/${invoiceId}/sealed-payments/${paymentId}?state=${state}`, { method: 'DELETE' });
  if (result.ok) revalidatePath('/', 'layout');
  return result;
}

/** "Povolit platbu kartou": the one plain amount the user opts to store; null switches it off. */
export async function setSealedCardAmount(invoiceId: string, amount: number | null) {
  const result = await call<{ id: string; cardAmount: string | null }>(`/api/v1/invoices/${invoiceId}/card-amount`, json('PUT', { amount }));
  if (result.ok) revalidatePath('/', 'layout');
  return result;
}

/**
 * A card payment of a sealed document that waits for this browser: Stripe
 * charged a plain amount, so the server keeps it (and the fee) in plain
 * until the payment is sealed under the document key.
 */
export interface CardPaymentToSeal {
  id: string;
  invoiceId: string;
  invoiceNumber: string | null;
  encAmounts: string;
  amount: string;
  fee: string | null;
  currency: string;
  paidAt: string | null;
}

/** One document's waiting card payments, or the whole company's. */
export async function fetchCardPaymentsToSeal(invoiceId?: string) {
  return call<CardPaymentToSeal[]>(invoiceId ? `/api/v1/invoices/${invoiceId}/card-payments/to-seal` : '/api/v1/invoices/sealed/card-payments');
}

/** Only the envelope leaves the tab; the server then forgets the plain numbers. A repeat is harmless. */
export async function sealCardPayment(invoiceId: string, cardPaymentId: string, encAmount: string) {
  if (!isSealed(encAmount)) return { ok: false as const, error: 'amounts_plaintext' };
  return call<{ sealed: boolean }>(`/api/v1/invoices/${invoiceId}/card-payments/${cardPaymentId}/seal`, json('POST', { enc_amount: encAmount }));
}

/** An issued sealed document still waiting for money, for bank matching in the browser. */
export interface OpenSealedDocument {
  id: string;
  invoiceNumber: string | null;
  documentType: string;
  variableSymbol: string | null;
  currency: string;
  issueDate: string | null;
  dueDate: string | null;
  encAmounts: string;
  payments: string[];
}

export async function fetchOpenSealedDocuments() {
  return call<OpenSealedDocument[]>('/api/v1/invoices/sealed/open');
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
