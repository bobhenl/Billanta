'use server';

import { revalidatePath } from 'next/cache';
import { backendMessage } from '@/lib/action-error';
import { apiFetch } from '@/lib/api-client';
import { errorCode, invoiceBody, resolveContact } from './invoice-body';
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
