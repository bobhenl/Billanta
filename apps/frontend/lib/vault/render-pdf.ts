'use client';

/** The decrypted texts of one encrypted document, as the browser opened them. */
export interface OpenedInvoiceTexts {
  noteAbove: string | null;
  noteBelow: string | null;
  items: { id: string; description: string }[];
}

/**
 * The one place that renders the PDF of an encrypted document in the
 * browser, so the decrypted texts never leave it. There is no browser
 * renderer yet, so this returns null and the outbox falls back to sending
 * the texts once through the server (after the member confirms). When a
 * renderer lands, plug it in here and the outbox uploads the finished PDF
 * instead.
 */
export async function renderSealedInvoicePdf(_invoiceId: string, _texts: OpenedInvoiceTexts): Promise<Blob | null> {
  return null;
}

/** Whether the browser can render the PDF itself, which decides what the outbox tells the member. */
export const browserRendersPdf = false;
