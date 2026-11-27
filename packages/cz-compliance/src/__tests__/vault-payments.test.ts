import { describe, expect, it, vi } from 'vitest';
import {
  amountTotals,
  decodePaymentAmounts,
  encodePaymentAmounts,
  fillSealedPdfAmounts,
  generateQrInvoiceString,
  parseInvoiceQr,
  sealedBalance,
  sealedQrInvoiceString,
  sealedSpaydString,
  suggestSealedMatches,
  type InvoicePdfModel,
  type MatchDocument,
  type SealedPdfAmounts,
  type SealedQrInvoicePlan,
} from '../index.js';

const nbsp = (s: string) => s.replace(/[  ]/g, ' ');

describe('sealed payment envelopes', () => {
  it('round-trips a payment and rounds to cents', () => {
    const plain = encodePaymentAmounts({ amount: 1000.004, fee: 12.5, receivedHome: null });
    expect(decodePaymentAmounts(plain)).toEqual({ amount: 1000, fee: 12.5, receivedHome: null });
    expect(decodePaymentAmounts(encodePaymentAmounts({ amount: 40, fee: 0, receivedHome: 1001.2 }))).toEqual({ amount: 40, fee: 0, receivedHome: 1001.2 });
  });

  it('refuses a zero or negative payment and anything that is not one', () => {
    expect(() => encodePaymentAmounts({ amount: 0, fee: 0, receivedHome: null })).toThrow('payment_amount');
    expect(() => encodePaymentAmounts({ amount: 10, fee: -1, receivedHome: null })).toThrow('payment_fee');
    expect(() => decodePaymentAmounts('{"amount":-5}')).toThrow('payment_amount');
    // An item's amounts opened by mistake must not count as a payment.
    expect(() => decodePaymentAmounts('{"quantity":1,"unitPrice":100}')).toThrow('payment_amount');
    expect(() => decodePaymentAmounts('[1]')).toThrow('payment_shape');
  });
});

describe('sealedBalance', () => {
  it('sums payments, fees and home-currency proceeds', () => {
    expect(
      sealedBalance(1210, [
        { amount: 500, fee: 5, receivedHome: 12000 },
        { amount: 200.1, fee: 0, receivedHome: null },
      ]),
    ).toEqual({ paid: 700.1, remaining: 509.9, fees: 5, receivedHome: 12000, state: 'partly_paid' });
  });

  it('is paid within half a cent and unpaid without payments', () => {
    expect(sealedBalance(100, [{ amount: 99.996, fee: 0, receivedHome: null }])).toMatchObject({ state: 'paid', remaining: 0 });
    expect(sealedBalance(100, [{ amount: 99.99, fee: 0, receivedHome: null }])).toMatchObject({ state: 'partly_paid', remaining: 0.01 });
    expect(sealedBalance(100, [])).toEqual({ paid: 0, remaining: 100, fees: 0, receivedHome: null, state: 'unpaid' });
  });

  it('caps the rest at zero for an overpayment', () => {
    expect(sealedBalance(100, [{ amount: 150, fee: 0, receivedHome: null }])).toMatchObject({ state: 'paid', remaining: 0, paid: 150 });
  });
});

describe('suggestSealedMatches', () => {
  const doc = (over: Partial<MatchDocument> = {}): MatchDocument => ({
    id: 'inv-1',
    currency: 'CZK',
    variableSymbol: '20260042',
    issueDate: '2026-10-01',
    dueDate: '2026-10-15',
    remaining: 1210,
    ...over,
  });
  const tx = (over: Partial<{ id: string; amount: number; currency: string; variableSymbol: string | null; transactionDate: string }> = {}) => ({
    id: 'tx-1',
    amount: 1210,
    currency: 'CZK',
    variableSymbol: '20260042',
    transactionDate: '2026-10-10',
    ...over,
  });

  it('matches symbol and amount, ignoring leading zeros', () => {
    expect(suggestSealedMatches([tx({ variableSymbol: '0020260042' })], [doc()])).toEqual([
      { transactionId: 'tx-1', invoiceId: 'inv-1', reason: 'vs_amount', ambiguous: false },
    ]);
  });

  it('offers a smaller payment with the right symbol as a partial one, never a larger one', () => {
    expect(suggestSealedMatches([tx({ amount: 500 })], [doc()])[0]).toMatchObject({ reason: 'vs_partial' });
    expect(suggestSealedMatches([tx({ amount: 1500 })], [doc()])).toEqual([]);
  });

  it('matches by amount alone only without a symbol and within the date window', () => {
    expect(suggestSealedMatches([tx({ variableSymbol: null })], [doc()])[0]).toMatchObject({ reason: 'amount_date' });
    expect(suggestSealedMatches([tx({ variableSymbol: '999' })], [doc()])).toEqual([]);
    expect(suggestSealedMatches([tx({ variableSymbol: null, transactionDate: '2026-12-15' })], [doc()])).toEqual([]);
    expect(suggestSealedMatches([tx({ variableSymbol: null, transactionDate: '2026-09-30' })], [doc()])).toEqual([]);
    expect(suggestSealedMatches([tx({ variableSymbol: null, transactionDate: '2026-12-14' })], [doc()])).toHaveLength(1);
  });

  it('skips another currency, a paid document and an outgoing payment', () => {
    expect(suggestSealedMatches([tx({ currency: 'EUR' })], [doc()])).toEqual([]);
    expect(suggestSealedMatches([tx()], [doc({ remaining: 0 })])).toEqual([]);
    expect(suggestSealedMatches([tx({ amount: -1210 })], [doc({ remaining: 1210 })])).toEqual([]);
  });

  it('prefers the symbol and flags a tie instead of guessing', () => {
    const docs = [doc({ id: 'a', variableSymbol: null }), doc({ id: 'b' })];
    expect(suggestSealedMatches([tx()], docs)).toEqual([{ transactionId: 'tx-1', invoiceId: 'b', reason: 'vs_amount', ambiguous: false }]);
    const tie = suggestSealedMatches([tx({ variableSymbol: null })], [doc({ id: 'a' }), doc({ id: 'b' })]);
    expect(tie).toEqual([{ transactionId: 'tx-1', invoiceId: 'a', reason: 'amount_date', ambiguous: true }]);
  });
});

const plan: SealedQrInvoicePlan = {
  invoiceNumber: '2026-0042',
  issueDate: '2026-10-01',
  currency: 'CZK',
  dueDate: '2026-10-15',
  taxableSupplyDate: '2026-10-01',
  variableSymbol: '20260042',
  supplierIco: '12345678',
  supplierDic: 'CZ12345678',
  customerIco: '87654321',
  vatPayer: true,
  advance: false,
  reverseCharge: false,
  iban: 'CZ6508000000192000145399',
};
const totals = amountTotals([
  { quantity: 1, unitPrice: 1000, vatRate: 21, discountPercent: 0 },
  { quantity: 1, unitPrice: 100, vatRate: 12, discountPercent: 0 },
]);

describe('sealed QR Faktura', () => {
  it('builds the same SID as a plain document once the totals are open', () => {
    expect(sealedQrInvoiceString(plan, totals)).toBe(
      generateQrInvoiceString({
        invoiceNumber: '2026-0042',
        issueDate: new Date('2026-10-01T00:00:00Z'),
        dueDate: new Date('2026-10-15T00:00:00Z'),
        taxableSupplyDate: new Date('2026-10-01T00:00:00Z'),
        totalAmount: 1322,
        currency: 'CZK',
        variableSymbol: '20260042',
        supplierIco: '12345678',
        supplierDic: 'CZ12345678',
        customerIco: '87654321',
        vatLines: [
          { rate: 12, base: 100, vat: 12 },
          { rate: 21, base: 1000, vat: 210 },
        ],
        advance: false,
        reverseCharge: false,
        iban: 'CZ6508000000192000145399',
      }),
    );
  });

  it('leaves the VAT recap out for a non-payer', () => {
    const sid = sealedQrInvoiceString({ ...plan, vatPayer: false }, totals);
    expect(sid).toContain('*AM:1322.00*');
    expect(sid).toContain('*TD:0*');
    expect(sid).not.toContain('TB0:');
  });

  it('embeds the invoice into the payment code with the amount due', () => {
    const spayd = sealedSpaydString({ iban: plan.iban!, currency: 'CZK', variableSymbol: '20260042', invoice: plan }, 322, totals);
    expect(spayd).toContain('*AM:322.00*');
    expect(parseInvoiceQr(spayd)).toMatchObject({ format: 'spayd+sid', invoiceNumber: '2026-0042' });
    // Without the totals the code still pays, it only carries no invoice.
    expect(sealedSpaydString({ iban: plan.iban!, currency: 'CZK', invoice: plan }, 322, null)).not.toContain('X-INV');
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
      units: [null],
      vatPayer: false,
      mayAskForPayment: true,
      quote: false,
      paid: false,
      labels: { base: 'Základ', vat: 'DPH', total: 'Celkem', totalToPay: 'Celkem k úhradě', totalQuote: 'Celkem nabídka' },
      fx: null,
      qr: { kind: 'spayd', label: 'QR PLATBA', params: { iban: 'CZ6508000000192000145399', currency: 'CZK', invoice: plan } },
      invoiceQr: { kind: 'invoice', label: 'QR FAKTURA', params: plan },
      ...sealed,
    },
  } as unknown as InvoicePdfModel;
}

const item = [{ quantity: 1, unitPrice: 1000, vatRate: 0, discountPercent: 0 }];

describe('sealed payments in the PDF model', () => {
  it('prints the paid part and asks only for the rest', async () => {
    const qr = vi.fn(async () => 'png');
    const { model } = await fillSealedPdfAmounts(sealedModel(), item, qr, [{ amount: 400, fee: 0, receivedHome: null }]);
    expect(qr).toHaveBeenCalledTimes(1);
    expect(qr).toHaveBeenCalledWith(expect.objectContaining({ kind: 'spayd' }), 600, expect.objectContaining({ totalWithVat: 1000 }));
    expect(nbsp(model.totals.paid!.amount)).toBe('−400,00 CZK');
    expect(nbsp(model.totals.paid!.remaining)).toBe('600,00 CZK');
    expect(model.totals.label).toBe('Celkem');
    expect(model.payment.qr).toEqual({ label: 'QR PLATBA', png: 'png' });
  });

  it('draws QR Faktura alone once nothing is due', async () => {
    const qr = vi.fn(async () => 'sid-png');
    const { model } = await fillSealedPdfAmounts(sealedModel({ qr: null }), item, qr, []);
    expect(qr).toHaveBeenCalledWith(expect.objectContaining({ kind: 'invoice' }), 1000, expect.objectContaining({ totalWithVat: 1000 }));
    expect(model.payment.qr).toEqual({ label: 'QR FAKTURA', png: 'sid-png' });

    const fully = vi.fn(async () => 'sid-png');
    const paid = await fillSealedPdfAmounts(sealedModel(), item, fully, [{ amount: 1000, fee: 0, receivedHome: null }]);
    expect(fully).toHaveBeenCalledWith(expect.objectContaining({ kind: 'invoice' }), 1000, expect.anything());
    expect(nbsp(paid.model.totals.paid!.remaining)).toBe('0,00 CZK');
  });

  it('prints no code without a plan', async () => {
    const qr = vi.fn(async () => 'png');
    const { model } = await fillSealedPdfAmounts(sealedModel({ qr: null, invoiceQr: null }), item, qr);
    expect(qr).not.toHaveBeenCalled();
    expect(model.payment.qr).toBeNull();
    expect(model.totals.paid).toBeNull();
  });
});
