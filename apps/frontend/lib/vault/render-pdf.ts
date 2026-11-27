'use client';

import type { VaultKey } from '@faktur/cz-compliance';
import { renderSealedPdf } from './documents';

/**
 * The PDF of an encrypted document, drawn in this browser by the same
 * renderer the server uses for plain documents (lib/vault/documents.ts), so
 * the outbox uploads a finished PDF and the decrypted texts never leave the tab.
 */
export async function renderSealedInvoicePdf(key: VaultKey, invoiceId: string): Promise<Blob> {
  return (await renderSealedPdf(key, invoiceId)).blob;
}
