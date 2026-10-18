'use server';

import { revalidatePath } from 'next/cache';
import { backendMessage } from '@/lib/action-error';
import { apiFetch, ApiError } from '@/lib/api-client';
import type { AresPrefill, Contact, InvoiceDraftInput, ItemSuggestion, SuggestionResult } from './types';

/**
 * Server actions behind the new-invoice form. They run on the Next server
 * with the signed-in user's backend JWT (lib/api-client.ts) — the browser
 * never talks to the backend or to Anthropic directly.
 */

/** Own contacts + register hits; `registry` picks the register ("auto" = CZ + SK, VIES for prefixed VAT numbers). */
export async function searchCustomers(query: string, registry = 'auto'): Promise<{ contacts: Contact[]; ares: AresPrefill[] }> {
  if (query.trim().length < 2) return { contacts: [], ares: [] };
  try {
    return await apiFetch(`/api/v1/contacts/search?q=${encodeURIComponent(query.trim())}&registry=${encodeURIComponent(registry)}`);
  } catch {
    return { contacts: [], ares: [] };
  }
}

/** One hit of the "Podle jiné faktury…" picker. */
export interface InvoiceToCopy {
  id: string;
  invoiceNumber: string | null;
  contactName: string | null;
  issueDate: string | null;
  total: string | number;
  currency: string;
  documentType: string;
}

/** Own documents by number, customer, IČO or symbol (backend fuzzy `q`); credit notes left out, newest first. */
export async function searchInvoicesToCopy(query: string): Promise<InvoiceToCopy[]> {
  if (query.trim().length < 2) return [];
  try {
    const rows = await apiFetch<InvoiceToCopy[]>(`/api/v1/invoices?q=${encodeURIComponent(query.trim())}`);
    return rows
      .filter((r) => r.documentType !== 'credit_note')
      .slice(0, 8)
      .map(({ id, invoiceNumber, contactName, issueDate, total, currency, documentType }) => ({ id, invoiceNumber, contactName, issueDate, total, currency, documentType }));
  } catch {
    return [];
  }
}

/** ČNB rate for the form's "load rate" button; null when ČNB is unreachable. */
export async function fetchExchangeRate(currency: string, date: string): Promise<number | null> {
  try {
    const res = await apiFetch<{ rate: number | null }>(
      `/api/v1/invoices/exchange-rate?currency=${encodeURIComponent(currency)}&date=${encodeURIComponent(date)}`
    );
    return res.rate;
  } catch {
    return null;
  }
}

export async function suggestItems(query: string): Promise<ItemSuggestion[]> {
  if (query.trim().length < 2) return [];
  try {
    return await apiFetch(`/api/v1/invoices/item-suggestions?q=${encodeURIComponent(query.trim())}`);
  } catch {
    return [];
  }
}

export async function suggestInvoice(text: string): Promise<{ ok: true; result: SuggestionResult } | { ok: false; error: string }> {
  try {
    const result = await apiFetch<SuggestionResult>('/api/v1/ai/invoice-suggestion', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text })
    });
    return { ok: true, result };
  } catch (error) {
    return { ok: false, error: errorCode(error, 'ai_provider_unavailable') };
  }
}

type SaveResult = { ok: true; id: string; issueError?: string } | { ok: false; error: string };

/**
 * Saves the reviewed form as a new draft (or, with `editId`, overwrites an
 * existing one — line items are replaced as a whole). A customer picked from
 * ARES becomes a saved contact first (with the registry's address and a
 * verified stamp), so the next invoice for them is one pick from "your
 * contacts". `issue` then numbers it right away; if only that step fails the
 * draft is still saved and the caller gets `issueError`.
 */
export async function saveInvoice(
  input: InvoiceDraftInput,
  options: { editId?: string; issue?: boolean; editReason?: string } = {}
): Promise<SaveResult> {
  let id: string;
  try {
    // A draft may have no customer yet; issuing needs one (the backend checks it too).
    if (!input.customer && options.issue) return { ok: false, error: 'customer_required' };
    const contactId = input.customer ? await resolveContact(input.customer) : null;
    if (input.customer && !contactId) return { ok: false, error: 'customer_required' };

    const body = {
      ...invoiceBody(input),
      contact_id: contactId,
      ...(options.editId ? {} : { source_ai: input.prefilledByAi, template_id: input.templateId ?? undefined }),
      ...(options.editReason ? { edit_reason: options.editReason } : {})
    };
    const invoice = await apiFetch<{ id: string }>(options.editId ? `/api/v1/invoices/${options.editId}` : '/api/v1/invoices', {
      method: options.editId ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    id = invoice.id;
  } catch (error) {
    return { ok: false, error: errorCode(error, 'save_failed') };
  }

  revalidatePath('/[locale]/(dashboard)/invoices', 'layout');
  if (!options.issue) return { ok: true, id };
  try {
    await apiFetch(`/api/v1/invoices/${id}/issue`, { method: 'POST' });
    return { ok: true, id };
  } catch (error) {
    return { ok: true, id, issueError: backendMessage(error) };
  }
}

async function resolveContact(customer: NonNullable<InvoiceDraftInput['customer']>): Promise<string | null> {
  if (customer.kind === 'contact') return customer.id;
  const a = customer.ares;
  const [created] = await apiFetch<Contact[]>('/api/v1/contacts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      legalName: a.legalName,
      ico: a.ico || undefined,
      dic: a.dic ?? undefined,
      addressStreet: a.addressStreet,
      addressCity: a.addressCity,
      addressPostalCode: a.addressPostalCode,
      addressCountry: a.addressCountry,
      isVatPayer: a.isVatPayer,
      aresVerified: true
    })
  });
  return created?.id ?? null;
}

/** Form state → backend snake_case; empty optional text becomes null so PATCH can clear it. */
function invoiceBody(input: InvoiceDraftInput) {
  const text = (value: string) => value.trim() || null;
  return {
    document_type: input.documentType,
    issue_date: input.issueDate || undefined,
    due_date: input.dueDate || null,
    taxable_supply_date: input.taxableSupplyDate === undefined ? undefined : input.taxableSupplyDate || null,
    currency: input.currency,
    bank_account_id: input.bankAccountId || null,
    // Already home currency per unit and empty at home (see the form); the API ignores it at home anyway.
    exchange_rate: Number(input.exchangeRate.replace(',', '.')) > 0 ? Number(input.exchangeRate.replace(',', '.')) : null,
    payment_method: input.paymentMethod,
    payment_method_label: text(input.paymentMethodLabel),
    payment_instructions: text(input.paymentInstructions),
    variable_symbol: text(input.variableSymbol),
    constant_symbol: text(input.constantSymbol),
    specific_symbol: text(input.specificSymbol),
    order_number: text(input.orderNumber),
    language: input.language,
    reverse_charge: input.reverseCharge,
    note_above: text(input.noteAbove),
    note_below: text(input.noteBelow),
    internal_note: text(input.internalNote),
    issue_place: text(input.issuePlace),
    issued_by_name: text(input.issuedByName),
    ...(input.amountPaid !== undefined ? { amount_paid: input.amountPaid } : {}),
    custom_fields: input.customFields
      .map((f) => ({ label: f.label.trim(), value: f.value.trim(), kind: f.kind ?? 'text', internal: Boolean(f.internal) }))
      .filter((f) => f.label && f.value),
    line_items: input.items.map((item) => ({
      description: item.description,
      quantity: item.quantity,
      unit: item.unit,
      code: item.code?.trim() || null,
      unit_price: item.unitPrice,
      vat_rate: item.vatRate,
      discount_percent: item.discountPercent
    }))
  };
}

/** The backend's `{ error: "<code>" }` body when it sent one, else a status-based fallback. */
function errorCode(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    try {
      const body = JSON.parse(error.body ?? '{}') as { error?: unknown; message?: { error?: unknown } | unknown };
      const nested = typeof body.message === 'object' && body.message ? (body.message as { error?: unknown }).error : undefined;
      const code = typeof body.error === 'string' && body.error.includes('_') ? body.error : nested;
      if (typeof code === 'string') return code;
    } catch {
      // not JSON
    }
    if (error.status === 402 || error.status === 403) return 'not_allowed';
  }
  return fallback;
}
