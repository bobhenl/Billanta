'use client';

import type { VaultKey } from '@faktur/cz-compliance';
import { renderSealedPdf } from './documents';

/** The decrypted texts of one encrypted document, as the browser opened them. */
export interface OpenedInvoiceTexts {
  noteAbove: string | null;
  noteBelow: string | null;
  items: { id: string; description: string }[];
  /** An encrypted buyer (category "contacts"): name and address as printed. */
  buyer?: Partial<Record<BuyerField, string | null>>;
  buyerContactPerson?: string | null;
}

export type BuyerField = 'legalName' | 'addressStreet' | 'addressCity' | 'addressPostalCode';

/**
 * The PDF of an encrypted document, drawn in this browser by the same
 * renderer the server uses for plain documents (lib/vault/documents.ts), so
 * the outbox uploads a finished PDF and the decrypted texts never leave the tab.
 */
export async function renderSealedInvoicePdf(key: VaultKey, invoiceId: string): Promise<Blob> {
  return (await renderSealedPdf(key, invoiceId)).blob;
}

/** Whether the browser can render the PDF itself, which decides what the outbox tells the member. */
export const browserRendersPdf = true;
