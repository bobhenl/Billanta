import { describe, expect, it, vi } from 'vitest';
import { generateDataKey, open, openInvoicePdfModel, renderInvoicePdf, seal, sealableModelTexts, type InvoicePdfModel } from '../index.js';

/** Only the fields the sealed-text checks look at; the renderer must refuse before drawing anything. */
function model(noteAbove: string | null, noteBelow: string | null, descriptions: string[]): InvoicePdfModel {
  return {
    noteAbove,
    notes: { reverseCharge: null, proforma: null, paymentInstructions: null, noteBelow, issuedBy: null },
    table: { showVat: true, lumpSum: false, hasDiscount: false, items: descriptions.map((description) => ({ description })) },
  } as unknown as InvoicePdfModel;
}

describe('shared invoice PDF renderer, Důvěrný režim', () => {
  it('refuses to draw any text that is still sealed, before touching pdfkit', async () => {
    const key = await generateDataKey();
    const PDFDocument = vi.fn();
    for (const m of [
      model(await seal(key, 'a'), null, ['plain']),
      model(null, await seal(key, 'b'), ['plain']),
      model(null, null, ['plain', await seal(key, 'c')]),
    ]) {
      await expect(renderInvoicePdf(PDFDocument as never, m, null)).rejects.toThrow('confidential_content');
    }
    expect(PDFDocument).not.toHaveBeenCalled();
  });

  it('opens every sealed text and leaves plain ones alone', async () => {
    const key = await generateDataKey();
    const sealed = model(await seal(key, 'Nad'), await seal(key, 'Pod'), ['Plain', await seal(key, 'Položka')]);
    const opened = await openInvoicePdfModel(sealed, (v) => open(key, v));
    expect(sealableModelTexts(opened)).toEqual(['Nad', 'Pod', 'Plain', 'Položka']);
    // The input model keeps its envelopes; the browser only ever opens a copy.
    expect(sealableModelTexts(sealed).filter((v) => v?.startsWith('enc:v1:'))).toHaveLength(3);
  });
});
