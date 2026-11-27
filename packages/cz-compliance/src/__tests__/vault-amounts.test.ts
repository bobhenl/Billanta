import { describe, expect, it, vi } from 'vitest';
import {
  AVAILABLE_VAULT_CATEGORIES,
  SEALED_ITEM_PLACEHOLDER,
  amountTotals,
  creditNoteAmounts,
  decodeDocumentAmounts,
  decodeItemAmounts,
  encodeDocumentAmounts,
  encodeItemAmounts,
  fillSealedIsdocAmounts,
  fillSealedPdfAmounts,
  formatPdfAmount,
  isItemPlaceholder,
  renderInvoicePdf,
  type InvoicePdfModel,
  type IsdocInvoiceInput,
  type SealedPdfAmounts,
} from '../index.js';

const nbsp = (s: string) => s.replace(/[  ]/g, ' ');

describe('vault amounts', () => {
  it('is an available category', () => {
    expect(AVAILABLE_VAULT_CATEGORIES).toContain('amounts');
  });

  it('round-trips item and document amounts and refuses anything else', () => {
    const item = { quantity: 2.5, unitPrice: 1200.1234, vatRate: 21, discountPercent: 10 };
    expect(decodeItemAmounts(encodeItemAmounts(item))).toEqual(item);
    expect(decodeItemAmounts(encodeItemAmounts({ ...item, vatRate: null })).vatRate).toBeNull();
    expect(() => decodeItemAmounts('{"quantity":"x","unitPrice":1}')).toThrow();
    expect(() => decodeItemAmounts('{"unitPrice":1}')).toThrow();
    const totals = amountTotals([item]);
    expect(decodeDocumentAmounts(encodeDocumentAmounts(totals))).toEqual(totals);
    expect(() => decodeDocumentAmounts('{"totalWithVat":1}')).toThrow();
  });

  it('recognises the placeholder as Postgres returns it', () => {
    expect(isItemPlaceholder({ quantity: '1.000', unitPrice: '0.0000', vatRate: null, discountPercent: '0.00' })).toBe(true);
    expect(isItemPlaceholder({ quantity: '1.000', unitPrice: '0.0000', vatRate: '21.00', discountPercent: '0' })).toBe(false);
    expect(isItemPlaceholder({ quantity: '2', unitPrice: '0', vatRate: null })).toBe(false);
    expect(isItemPlaceholder({ ...SEALED_ITEM_PLACEHOLDER, unitPrice: 5 })).toBe(false);
  });

  it('rounds once per VAT bucket, like the server', () => {
    // 3 × 0.333 at 21 %: per-line rounding would give 1.20, per bucket 1.21.
    const t = amountTotals([
      { quantity: 1, unitPrice: 0.333, vatRate: 21, discountPercent: 0 },
      { quantity: 1, unitPrice: 0.333, vatRate: 21, discountPercent: 0 },
      { quantity: 1, unitPrice: 0.333, vatRate: 21, discountPercent: 0 },
      { quantity: 2, unitPrice: 50, vatRate: 12, discountPercent: 50 },
      { quantity: 1, unitPrice: 10, vatRate: null, discountPercent: 0 },
    ]);
    expect(t.byRate.map((r) => r.vatRatePercent)).toEqual([0, 12, 21]);
    expect(t.byRate[2]).toEqual({ vatRatePercent: 21, totalWithoutVat: 1, vatAmount: 0.21, totalWithVat: 1.21 });
    expect(t.totalWithoutVat).toBe(61);
    expect(t.totalVat).toBe(6.21);
    expect(t.totalWithVat).toBe(67.21);
  });

  it('fills an ISDOC input built with placeholders', () => {
    const input = {
      lineItems: [{ description: 'x', quantity: 1, unitPriceWithoutVat: 0, vatRate: 'zero', vatRatePercent: 0 }],
      totals: { totalWithoutVat: 0, totalVat: 0, totalWithVat: 0, vatRecapitulation: [] },
    } as unknown as IsdocInvoiceInput;
    const out = fillSealedIsdocAmounts(input, [{ quantity: 2, unitPrice: 100, vatRate: 12, discountPercent: 10 }]);
    expect(out.lineItems[0]).toMatchObject({ quantity: 2, unitPriceWithoutVat: 90, vatRate: 'reduced', vatRatePercent: 12 });
    expect(out.totals).toMatchObject({ totalWithoutVat: 180, totalVat: 21.6, totalWithVat: 201.6 });
    expect(() => fillSealedIsdocAmounts(input, [])).toThrow('amounts_mismatch');
  });

  it('charges no VAT under reverse charge', () => {
    const t = amountTotals([{ quantity: 1, unitPrice: 100, vatRate: 21, discountPercent: 0 }], { reverseCharge: true });
    expect(t).toMatchObject({ totalVat: 0, totalWithVat: 100, byRate: [{ vatRatePercent: 0 }] });
  });

  it('credits the final invoice of a paid proforma with its whole opened total', () => {
    const input = {
      lineItems: [{ description: 'x', quantity: 1, unitPriceWithoutVat: 0, vatRate: 'zero', vatRatePercent: 0 }],
      totals: { totalWithoutVat: 0, totalVat: 0, totalWithVat: 0, vatRecapitulation: [], paidDepositsAmount: 0 },
    } as unknown as IsdocInvoiceInput;
    const item = { quantity: 2, unitPrice: 100, vatRate: 21, discountPercent: 0 };
    expect(fillSealedIsdocAmounts(input, [item], { depositIsTotal: true }).totals.paidDepositsAmount).toBe(242);
    expect(fillSealedIsdocAmounts(input, [item]).totals.paidDepositsAmount).toBe(0);
  });

  it('negates the items of a credit note and leaves the invoice items alone', () => {
    const items = [
      { quantity: 2, unitPrice: 100, vatRate: 21, discountPercent: 10 },
      { quantity: 1, unitPrice: 50, vatRate: 12, discountPercent: 0 },
    ];
    const note = creditNoteAmounts(items);
    expect(note.items.map((i) => i.quantity)).toEqual([-2, -1]);
    expect(note.items[0]).toMatchObject({ unitPrice: 100, vatRate: 21, discountPercent: 10 });
    expect(items[0]!.quantity).toBe(2);
    expect(note.totals).toMatchObject({ totalWithoutVat: -230, totalVat: -43.8, totalWithVat: -273.8 });
    expect(creditNoteAmounts(items, { reverseCharge: true }).totals).toMatchObject({ totalVat: 0, totalWithVat: -230 });
  });
});

function sealedModel(sealed: Partial<SealedPdfAmounts> = {}): InvoicePdfModel {
  return {
    noteAbove: null,
    notes: { reverseCharge: null, proforma: null, paymentInstructions: null, noteBelow: null, issuedBy: null },
    customer: { name: 'A', lines: [] },
    table: { showVat: false, lumpSum: false, hasDiscount: false, items: [{ description: 'Práce', code: null, quantity: '1', unitPrice: '0,00 CZK', discount: '', vatRate: '0%', total: '0,00 CZK' }] },
    totals: { showVat: false, byRate: [], label: 'Celkem', amount: '0,00 CZK', paid: null, fx: null },
    payment: { rows: [], qr: null, linkQr: null },
    sealedAmounts: {
      currency: 'CZK',
      reverseCharge: false,
      items: ['enc:v1:x'],
      units: ['h'],
      vatPayer: true,
      mayAskForPayment: true,
      quote: false,
      paid: false,
      labels: { base: 'Základ', vat: 'DPH', total: 'Celkem', totalToPay: 'Celkem k úhradě', totalQuote: 'Celkem nabídka' },
      fx: null,
      qr: { kind: 'spayd', label: 'QR PLATBA', params: { iban: 'CZ6508000000192000145399', currency: 'CZK' } },
      ...sealed,
    },
  } as unknown as InvoicePdfModel;
}

describe('sealed amounts in the PDF model', () => {
  it('refuses to draw a model whose amounts are not filled in', async () => {
    const PDFDocument = vi.fn();
    await expect(renderInvoicePdf(PDFDocument as never, sealedModel(), null)).rejects.toThrow('confidential_content');
    expect(PDFDocument).not.toHaveBeenCalled();
  });

  it('fills the table, totals and the payment code from the opened items', async () => {
    const qr = vi.fn(async () => 'data:image/png;base64,AA');
    const { model, totals } = await fillSealedPdfAmounts(sealedModel(), [{ quantity: 2, unitPrice: 500, vatRate: 21, discountPercent: 0 }], qr);
    expect(model.sealedAmounts).toBeUndefined();
    expect(totals.totalWithVat).toBe(1210);
    expect(nbsp(model.table.items[0]!.quantity)).toBe('2 h');
    expect(nbsp(model.table.items[0]!.total)).toBe('1 000,00 CZK');
    expect(model.totals.label).toBe('Celkem k úhradě');
    expect(nbsp(model.totals.amount)).toBe(nbsp(formatPdfAmount(1210, 'CZK')));
    expect(model.totals.byRate).toHaveLength(1);
    expect(qr).toHaveBeenCalledWith(expect.objectContaining({ kind: 'spayd' }), 1210, expect.objectContaining({ totalWithVat: 1210 }));
    expect(model.payment.qr).toEqual({ label: 'QR PLATBA', png: 'data:image/png;base64,AA' });
  });

  it('asks for nothing on a paid document or a quote', async () => {
    const qr = vi.fn(async () => 'png');
    const paid = await fillSealedPdfAmounts(sealedModel({ paid: true }), [{ quantity: 1, unitPrice: 100, vatRate: 0, discountPercent: 0 }], qr);
    expect(paid.model.totals.label).toBe('Celkem');
    expect(paid.model.totals.paid).not.toBeNull();
    const quote = await fillSealedPdfAmounts(sealedModel({ quote: true, mayAskForPayment: false }), [{ quantity: 1, unitPrice: 100, vatRate: 0, discountPercent: 0 }], qr);
    expect(quote.model.totals.label).toBe('Celkem nabídka');
    expect(qr).not.toHaveBeenCalled();
  });

  it('refuses items that do not match the table', async () => {
    await expect(fillSealedPdfAmounts(sealedModel(), [], async () => null)).rejects.toThrow('amounts_mismatch');
  });
});
