'use server';

import { apiFetch } from '@/lib/api-client';
import type { InvoiceRow } from '@/lib/invoice-ui';

export interface PaletteInvoice {
  id: string;
  number: string | null;
  type: InvoiceRow['documentType'];
  status: InvoiceRow['status'];
  contact: string | null;
  ico: string | null;
  vs: string | null;
  total: number;
  currency: string;
  date: string | null;
}

export interface PaletteContact {
  id: string;
  name: string;
  ico: string | null;
  email: string | null;
}

/**
 * Compact invoice and contact rows for the Ctrl+K palette, fetched once when
 * it opens and searched client-side. A section the member can't read (403)
 * just comes back empty.
 */
export async function loadPaletteData(): Promise<{ invoices: PaletteInvoice[]; contacts: PaletteContact[]; aiReady: boolean }> {
  const [invoices, contacts, ai] = await Promise.all([
    apiFetch<InvoiceRow[]>('/api/v1/invoices').catch(() => [] as InvoiceRow[]),
    apiFetch<{ id: string; legalName: string; ico: string | null; email: string | null }[]>('/api/v1/contacts').catch(() => []),
    apiFetch<{ mode: string; hasOwnKey: boolean; platformAvailable: boolean }>('/api/v1/ai/settings').catch(() => null)
  ]);
  return {
    invoices: invoices.map((r) => ({
      id: r.id,
      number: r.invoiceNumber,
      type: r.documentType,
      status: r.status,
      contact: r.contactName,
      ico: r.contactIco,
      vs: r.variableSymbol,
      total: r.total,
      currency: r.currency,
      date: r.issueDate ?? r.createdAt
    })),
    contacts: contacts.map((c) => ({ id: c.id, name: c.legalName, ico: c.ico, email: c.email })),
    // Same rule as the invoice form's `aiUsable`.
    aiReady: Boolean(ai && ai.mode !== 'off' && (ai.mode === 'own' ? ai.hasOwnKey : ai.platformAvailable))
  };
}
