import { describe, expect, it } from 'vitest';
import {
  AUDIT_FX_TOLERANCE,
  auditInvoice,
  auditTransactionKind,
  openPaymentAuditInputs,
  paymentAuditEnvelopes,
  paymentAuditOf,
  type AuditInvoice,
  type AuditPayment,
  type AuditTransaction,
  type DocumentAmounts,
  type PaymentAmounts,
  type PaymentAuditInputs,
} from '../index.js';

const pay = (over: Partial<AuditPayment> = {}): AuditPayment => ({
  id: 'p1',
  kind: 'bank',
  source: 'c:fio',
  date: '2025-03-10',
  amount: 12100,
  currency: 'CZK',
  fee: null,
  homeRate: 1,
  ...over,
});

const inv = (over: Partial<AuditInvoice> = {}): AuditInvoice => ({
  id: 'i1',
  number: '2025001',
  customer: 'Alfa s.r.o.',
  currency: 'CZK',
  total: 12100,
  rate: 1,
  issueDate: '2025-03-01',
  dueDate: '2025-03-15',
  paidAt: '2025-03-10',
  paymentMethod: 'bank_transfer',
  markedPaid: true,
  paidInFull: true,
  recordedFee: 0,
  payments: [pay()],
  ...over,
});

const tx = (over: Partial<AuditTransaction> = {}): AuditTransaction => ({
  id: 't1',
  kind: 'bank',
  source: 'c:fio',
  date: '2025-04-02',
  amount: 3300,
  currency: 'CZK',
  fee: null,
  homeRate: 1,
  externalId: null,
  status: 'unmatched',
  matchedInvoiceId: null,
  matchedInvoiceStatus: null,
  matchedInvoiceNumber: null,
  matchedExpenseId: null,
  transferPairId: null,
  counterpartyName: 'Beta a.s.',
  counterpartyAccount: '123/0100',
  message: null,
  variableSymbol: '777',
  ...over,
});

describe('auditInvoice', () => {
  it('paid in full, to the cent', () => {
    expect(auditInvoice(inv())).toEqual({ status: 'paid', received: 12100, fee: 0, difference: 0, differenceHome: 0 });
  });

  it('two partial payments that add up are paid', () => {
    const v = auditInvoice(inv({ payments: [pay({ amount: 7000 }), pay({ id: 'p2', amount: 5100 })] }));
    expect(v.status).toBe('paid');
    expect(v.received).toBe(12100);
  });

  it('underpaid shows the difference in the invoice currency and in CZK', () => {
    const v = auditInvoice(inv({ currency: 'EUR', total: 1000, rate: 25.1, payments: [pay({ currency: 'EUR', amount: 960, homeRate: 25.3 })] }));
    expect(v).toEqual({ status: 'underpaid', received: 960, fee: 0, difference: 40, differenceHome: 1004 });
  });

  it('a shortfall the recorded fee explains is paid with a fee, not underpaid', () => {
    const v = auditInvoice(inv({ currency: 'EUR', total: 500, rate: 25, payments: [pay({ currency: 'EUR', amount: 485.2, fee: 14.8, homeRate: 25 })] }));
    expect(v.status).toBe('paid_fee');
    expect(v.fee).toBe(14.8);
    expect(v.difference).toBe(14.8);
  });

  it('a fee typed on the invoice explains the shortfall too', () => {
    const v = auditInvoice(inv({ total: 12100, recordedFee: 37, payments: [pay({ amount: 12063 })] }));
    expect(v.status).toBe('paid_fee');
    expect(v.fee).toBe(37);
  });

  it('a gross payment with a fee is paid with a fee', () => {
    const v = auditInvoice(inv({ payments: [pay({ amount: 12100, fee: 182.5 })] }));
    expect(v.status).toBe('paid_fee');
    expect(v.difference).toBe(0);
  });

  it('a fee that only covers part of the shortfall stays underpaid', () => {
    const v = auditInvoice(inv({ payments: [pay({ amount: 11900, fee: 50 })] }));
    expect(v.status).toBe('underpaid');
    expect(v.difference).toBe(200);
  });

  it('one cent short in the same currency is underpaid (no FX tolerance there)', () => {
    expect(auditInvoice(inv({ payments: [pay({ amount: 12099.99 })] })).status).toBe('underpaid');
  });

  it('FX: within tolerance is paid, just outside is underpaid', () => {
    // 1 000 EUR at 25.00 = 25 000 CZK; 1 % is 250 CZK.
    const eur = (czk: number) => inv({ currency: 'EUR', total: 1000, rate: 25, payments: [pay({ amount: czk, currency: 'CZK', homeRate: 1 })] });
    const inside = auditInvoice(eur(24760));
    expect(inside.status).toBe('paid');
    expect(inside.difference).toBe(9.6);
    const outside = auditInvoice(eur(24740));
    expect(outside.status).toBe('underpaid');
    expect(outside.difference).toBe(10.4);
    expect(outside.differenceHome).toBe(260);
    expect(AUDIT_FX_TOLERANCE).toBe(0.01);
  });

  it('FX: a payment above the tolerance is overpaid, within it paid', () => {
    const eur = (czk: number) => inv({ currency: 'EUR', total: 1000, rate: 25, payments: [pay({ amount: czk, currency: 'CZK', homeRate: 1 })] });
    expect(auditInvoice(eur(25240)).status).toBe('paid');
    expect(auditInvoice(eur(25260)).status).toBe('overpaid');
  });

  it('FX: a payment in another currency without a rate cannot be verified', () => {
    expect(auditInvoice(inv({ currency: 'EUR', total: 1000, rate: 25, payments: [pay({ currency: 'USD', amount: 1100, homeRate: null })] })).status).toBe('unverified');
  });

  it('overpaid shows a negative difference', () => {
    const v = auditInvoice(inv({ payments: [pay({ amount: 12600 })] }));
    expect(v).toEqual({ status: 'overpaid', received: 12600, fee: 0, difference: -500, differenceHome: -500 });
  });

  it('not paid and no money is unpaid', () => {
    const v = auditInvoice(inv({ markedPaid: false, paidInFull: false, paidAt: null, payments: [] }));
    expect(v.status).toBe('unpaid');
    expect(v.difference).toBe(12100);
  });

  it('marked paid with no money in any source is manual', () => {
    expect(auditInvoice(inv({ payments: [] })).status).toBe('manual');
  });

  it('a partial payment recorded by hand is manual too', () => {
    expect(auditInvoice(inv({ markedPaid: true, paidInFull: false, payments: [] })).status).toBe('manual');
  });

  it('sealed total or sealed payment is sealed, not unpaid', () => {
    expect(auditInvoice(inv({ total: null, payments: [] })).status).toBe('sealed');
    expect(auditInvoice(inv({ payments: [pay({ amount: null, kind: 'card' })] })).status).toBe('sealed');
  });
});

describe('auditTransactionKind', () => {
  it('a row nobody paired is a payment without an invoice', () => {
    expect(auditTransactionKind(tx())).toBe('no_invoice');
  });

  it('paired with an issued or paid document', () => {
    expect(auditTransactionKind(tx({ status: 'matched', matchedInvoiceId: 'i1', matchedInvoiceStatus: 'paid' }))).toBe('paired');
    // An invoice this member cannot see (private) is still a pairing.
    expect(auditTransactionKind(tx({ status: 'matched', matchedInvoiceId: 'i9', matchedInvoiceStatus: null }))).toBe('paired');
  });

  it('paired only with a draft or cancelled document', () => {
    expect(auditTransactionKind(tx({ status: 'matched', matchedInvoiceId: 'i1', matchedInvoiceStatus: 'draft' }))).toBe('not_issued');
    expect(auditTransactionKind(tx({ status: 'matched', matchedInvoiceId: 'i1', matchedInvoiceStatus: 'cancelled' }))).toBe('not_issued');
  });

  it('an expense refund is paired', () => {
    expect(auditTransactionKind(tx({ status: 'matched', matchedExpenseId: 'e1' }))).toBe('paired');
  });

  it('the bank leg of a PayPal withdrawal is an own transfer', () => {
    expect(auditTransactionKind(tx({ status: 'ignored', transferPairId: 'pp1', counterpartyName: 'PayPal Europe' }))).toBe('transfer');
  });

  it('a PayPal conversion is excluded', () => {
    expect(auditTransactionKind(tx({ externalId: 'paypal:X1', status: 'ignored', counterpartyName: null, message: '100.00 USD → 2300.00 CZK' }))).toBe('conversion');
  });

  it('an ignored PayPal payment from a person is ignored, not a conversion', () => {
    expect(auditTransactionKind(tx({ externalId: 'paypal:X2', status: 'ignored', counterpartyName: 'John', message: 'thanks → you' }))).toBe('ignored');
  });
});

const inputs = (over: Partial<PaymentAuditInputs> = {}): PaymentAuditInputs => ({
  year: 2025,
  from: '2025-01-01',
  to: '2026-01-01',
  home: 'CZK',
  sources: [],
  invoices: [],
  transactions: [],
  ...over,
});

describe('paymentAuditOf', () => {
  const report = paymentAuditOf(
    inputs({
      invoices: [
        inv({ id: 'a' }),
        inv({ id: 'b', currency: 'EUR', total: 1000, rate: 25.1, payments: [pay({ currency: 'EUR', amount: 960, homeRate: 25.3 })] }),
        inv({ id: 'c', payments: [pay({ amount: 12600 })] }),
        inv({ id: 'd', payments: [] }),
        inv({ id: 'e', recordedFee: 37, payments: [pay({ amount: 12063, fee: 37 })] }),
      ],
      transactions: [
        tx({ id: 'paired', amount: 12100, status: 'matched', matchedInvoiceId: 'a', matchedInvoiceStatus: 'paid' }),
        tx({ id: 'free', amount: 3300 }),
        tx({ id: 'eur', amount: 200, currency: 'EUR', homeRate: 25, source: 'wise' }),
        tx({ id: 'ign', amount: 50, status: 'ignored' }),
        tx({ id: 'pp', amount: 8000, status: 'ignored', transferPairId: 'x', counterpartyName: 'PayPal Europe' }),
        tx({ id: 'conv', amount: 2300, source: 'paypal', externalId: 'paypal:1', status: 'ignored', counterpartyName: null, message: '100.00 USD → 2300.00 CZK' }),
        tx({ id: 'likely', amount: 4000, counterpartyName: 'PAYPAL EUROPE S.A.R.L.' }),
        tx({ id: 'stripe', amount: 500, fee: 7.5, source: 'stripe', status: 'matched', matchedInvoiceId: 'z', matchedInvoiceStatus: 'issued' }),
      ],
    }),
  );

  it('counts the statuses', () => {
    expect(report.totals.byStatus).toMatchObject({ paid: 1, underpaid: 1, overpaid: 1, manual: 1, paid_fee: 1, unpaid: 0 });
    expect(report.totals.underpaidHome).toBe(1004);
    expect(report.totals.overpaidHome).toBe(500);
    expect(report.totals.feesHome).toBe(37);
  });

  it('lists only the incoming money that no invoice explains, without own moves', () => {
    expect(report.transactions.map((t) => t.id)).toEqual(['free', 'eur', 'ign', 'likely']);
    expect(report.transactions.find((t) => t.id === 'likely')!.likelyTransfer).toBe(true);
    expect(report.transactions.find((t) => t.id === 'free')!.likelyTransfer).toBe(false);
    expect(report.totals.withoutInvoice).toEqual({ count: 3, amount: 7500, homeAmount: 12300 });
  });

  it('sums each source by currency, own moves apart', () => {
    const fio = report.sources.find((s) => s.source === 'c:fio' && s.currency === 'CZK')!;
    expect(fio.incoming).toEqual({ count: 4, amount: 19450 });
    expect(fio.paired).toEqual({ count: 1, amount: 12100 });
    expect(fio.withoutInvoice).toEqual({ count: 2, amount: 7300 });
    expect(fio.ignored).toEqual({ count: 1, amount: 50 });
    expect(fio.ownMoves).toEqual({ count: 1, amount: 8000 });
    expect(fio.homeAmount).toBe(19450);
    const paypal = report.sources.find((s) => s.source === 'paypal')!;
    expect(paypal.incoming.count).toBe(0);
    expect(paypal.ownMoves).toEqual({ count: 1, amount: 2300 });
    const stripe = report.sources.find((s) => s.source === 'stripe')!;
    expect(stripe.fees).toBe(7.5);
    expect(report.sources.find((s) => s.source === 'wise')!.homeAmount).toBe(5000);
  });

  it('a row without a rate leaves the source without a home sum', () => {
    const r = paymentAuditOf(inputs({ transactions: [tx({ amount: 10, currency: 'USD', homeRate: null })] }));
    expect(r.sources[0]!.homeAmount).toBeNull();
  });
});

describe('sealed amounts', () => {
  const sealedInputs = inputs({
    invoices: [
      inv({ id: 's1', total: null, recordedFee: null, encAmounts: 'enc:doc1', payments: [pay({ id: 'cs1', kind: 'card', source: 'card', amount: null, fee: null, encAmount: 'enc:pay1' })] }),
      inv({ id: 's2', total: null, recordedFee: null, encAmounts: 'enc:doc2', payments: [] }),
    ],
    transactions: [tx({ id: 'cs1', kind: 'card', source: 'card', amount: 0, amountUnknown: true, encAmount: 'enc:pay1', status: 'matched', matchedInvoiceId: 's1', matchedInvoiceStatus: 'paid' })],
  });

  it('the server report keeps them sealed and does not sum them', () => {
    const r = paymentAuditOf(sealedInputs);
    expect(r.invoices.map((i) => i.status)).toEqual(['sealed', 'sealed']);
    expect(r.sources[0]!.unknownAmounts).toBe(1);
    expect(r.sources[0]!.incoming).toEqual({ count: 1, amount: 0 });
  });

  it('lists the envelopes once each', () => {
    expect(paymentAuditEnvelopes(sealedInputs)).toEqual({ documents: ['enc:doc1', 'enc:doc2'], payments: ['enc:pay1'] });
  });

  it('opened envelopes give the real statuses; an unopened one stays sealed', () => {
    const doc = (total: number): DocumentAmounts => ({ totalWithoutVat: total, totalVat: 0, totalWithVat: total, byRate: [] } as unknown as DocumentAmounts);
    const documents = new Map([['enc:doc1', doc(1000)]]);
    const payments = new Map<string, PaymentAmounts>([['enc:pay1', { amount: 1000, fee: 29, receivedHome: null }]]);
    const { inputs: opened, missing } = openPaymentAuditInputs(sealedInputs, documents, payments);
    expect(missing).toBe(1);
    const r = paymentAuditOf(opened);
    expect(r.invoices.map((i) => i.status)).toEqual(['paid_fee', 'sealed']);
    expect(r.invoices[0]!.fee).toBe(29);
    expect(r.sources[0]).toMatchObject({ incoming: { count: 1, amount: 1000 }, fees: 29, unknownAmounts: 0 });
  });
});
