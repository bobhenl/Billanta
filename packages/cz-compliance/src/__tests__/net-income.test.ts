import { describe, expect, it } from 'vitest';
import {
  buildSealedNetIncome,
  computeNetIncome,
  netIncomeAmountOf,
  netIncomeReportOf,
  netIncomeSpanOf,
  sealedNetIncomeEnvelopes,
  type DocumentAmounts,
  type NetIncomeInputs,
  type NetIncomeInvoice,
  type NetIncomeTaxModel,
  type SealedNetIncomeDoc,
} from '../index.js';

const env = (n: number) => `enc:v1:AAAAAAAAAAAAAAA${n}:${'Q'.repeat(24)}`;
const wire = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const amounts = (base: number, rate = 21): DocumentAmounts => ({
  totalWithoutVat: base,
  totalVat: (base * rate) / 100,
  totalWithVat: base * (1 + rate / 100),
  byRate: [{ vatRatePercent: rate, totalWithoutVat: base, vatAmount: (base * rate) / 100, totalWithVat: base * (1 + rate / 100) }],
});

const rates = {
  flat_expense_percent: 60,
  flat_expense_cap: 1_200_000,
  income_tax_percent: 15,
  social_rate_percent: 29.2,
  social_base_percent: 55,
  health_rate_percent: 13.5,
  health_base_percent: 50,
};
const model: NetIncomeTaxModel = {
  ...rates,
  years: {},
  partners: [
    { id: 'a', name: 'A', share: 1, tax_credits: 30_840 },
    { id: 'b', name: 'B', share: 1, tax_credits: 30_840 },
  ],
  shared_expenses: [{ label: 'Kancelář', amount: 6_000, per: 'month', date: null, from: null, to: null, shares: null }],
  extra_income: [
    { date: '2026-02-10', label: 'Poplatek', amount: 4_000, shares: { a: 1 } },
    { date: '2026-05-01', label: 'Mimo období', amount: 99_000, shares: null },
  ],
};

const plain = (id: string, paidAt: string, income: number, over: Partial<NetIncomeInvoice> = {}): NetIncomeInvoice => ({
  id,
  number: id,
  customer: 'Alfa',
  paidAt,
  month: Number(paidAt.slice(5, 7)),
  currency: 'CZK',
  amount: income,
  income,
  source: 'czk',
  partnerShares: null,
  claimedShares: null,
  ...over,
});
const sealed = (id: string, paidAt: string, n: number, over: Partial<SealedNetIncomeDoc> = {}): SealedNetIncomeDoc => ({
  id,
  number: id,
  customer: 'Beta',
  paidAt,
  month: Number(paidAt.slice(5, 7)),
  currency: 'CZK',
  partnerShares: null,
  claimedShares: null,
  documentType: 'invoice',
  encAmounts: env(n),
  rate: 1,
  ...over,
});

/** Q1 2026: one plain invoice; the sealed ones are added by the tests. */
const inputs = (over: Partial<NetIncomeInputs> = {}): NetIncomeInputs =>
  wire({
    period: { year: 2026, month: null, quarter: 1, months: 3, from: '2026-01-01', to: '2026-04-01' },
    vatPayer: false,
    model,
    invoices: [plain('P1', '2026-01-15', 100_000)],
    missingRates: 0,
    sealedDocs: [],
    ...over,
  });

describe('netIncomeSpanOf', () => {
  it('turns a month, a quarter and a year into their first month and length', () => {
    expect(netIncomeSpanOf({ year: 2026, month: 7, quarter: null })).toEqual({ year: 2026, month: 7, months: 1 });
    expect(netIncomeSpanOf({ year: 2026, month: null, quarter: 3 })).toEqual({ year: 2026, month: 7, months: 3 });
    expect(netIncomeSpanOf({ year: 2026, month: null, quarter: null })).toEqual({ year: 2026, month: 1, months: 12 });
  });
});

describe('netIncomeAmountOf', () => {
  it('takes the base for a VAT payer, the total otherwise, and a credit note negative', () => {
    expect(netIncomeAmountOf(amounts(1_000), 'invoice', true)).toBe(1_000);
    expect(netIncomeAmountOf(amounts(1_000), 'invoice', false)).toBe(1_210);
    expect(netIncomeAmountOf(amounts(-1_000), 'credit_note', false)).toBe(-1_210);
  });
});

describe('netIncomeReportOf', () => {
  it('counts the invoices and the extra income inside the period, and each month on its own', () => {
    const r = netIncomeReportOf(inputs());
    // 100 000 split in two plus the fee for A; the May extra income is outside Q1.
    expect(r.result.partners.map((p) => p.income)).toEqual([54_000, 50_000]);
    expect(r.extraIncome.map((e) => e.index)).toEqual([0]);
    expect(r.result).toEqual(computeNetIncome(model, [{ amount: 100_000, shares: null }, { amount: 4_000, shares: { a: 1 } }], { year: 2026, month: 1, months: 3 }));
    expect(r.byMonth!.map((m) => [m.month, m.income, m.sharedExpenses])).toEqual([
      [1, 100_000, 6_000],
      [2, 4_000, 6_000],
      [3, 0, 6_000],
    ]);
    expect(r.result.totals.sharedExpenses).toBe(18_000);
    expect(r.settings).toMatchObject({ ...rates, source: null, tax_scope: 'per_partner', partners: { a: { tax_credits: 30_840 } } });
    expect(r.tips).toContainEqual({ code: 'year_settings_missing', year: 2026, from: null });
  });

  it('has no month breakdown for a single month', () => {
    const r = netIncomeReportOf(inputs({ period: { year: 2026, month: 1, quarter: null, months: 1, from: '2026-01-01', to: '2026-02-01' } }));
    expect(r.byMonth).toBeNull();
    expect(r.extraIncome).toEqual([]);
  });
});

describe('buildSealedNetIncome', () => {
  it('builds the same report as the server would with the same documents in plain', () => {
    const docs = [
      sealed('S1', '2026-02-03', 1, { partnerShares: { b: 1 } }),
      sealed('S2', '2026-03-09', 2, { currency: 'EUR', rate: 25 }),
      sealed('S3', '2026-03-20', 3, { documentType: 'credit_note' }),
    ];
    const opened = new Map([
      [env(1), amounts(10_000)],
      [env(2), amounts(1_000)],
      [env(3), amounts(-2_000)],
    ]);
    const out = buildSealedNetIncome(inputs({ vatPayer: true, sealedDocs: docs }), opened);
    const expected = netIncomeReportOf(
      inputs({
        vatPayer: true,
        invoices: [
          plain('P1', '2026-01-15', 100_000),
          plain('S1', '2026-02-03', 10_000, { customer: 'Beta', partnerShares: { b: 1 } }),
          plain('S2', '2026-03-09', 25_000, { customer: 'Beta', currency: 'EUR', amount: 1_000, source: 'converted' }),
          plain('S3', '2026-03-20', -2_000, { customer: 'Beta' }),
        ],
      }),
    );
    expect(out).toEqual({ report: expected, missing: 0 });
    // A's half of P1 and the fee, half of the EUR invoice and of the credit note; B has S1 on its own.
    expect(out.report!.result.partners.map((p) => p.income)).toEqual([50_000 + 4_000 + 12_500 - 1_000, 50_000 + 10_000 + 12_500 - 1_000]);
  });

  it('lists the documents in the order paid', () => {
    const out = buildSealedNetIncome(inputs({ sealedDocs: [sealed('S1', '2026-01-02', 1), sealed('S2', '2026-01-15', 2)] }), new Map([
      [env(1), amounts(1_000)],
      [env(2), amounts(1_000)],
    ]));
    expect(out.report!.invoices.map((i) => i.id)).toEqual(['S1', 'P1', 'S2']);
  });

  it('takes the total with VAT for a non-payer', () => {
    const out = buildSealedNetIncome(inputs({ sealedDocs: [sealed('S1', '2026-02-03', 1)] }), new Map([[env(1), amounts(10_000)]]));
    expect(out.report!.invoices.find((i) => i.id === 'S1')).toMatchObject({ amount: 12_100, income: 12_100, source: 'czk' });
  });

  it('leaves a sealed document without a rate out, like a plain one', () => {
    const out = buildSealedNetIncome(inputs({ missingRates: 1, sealedDocs: [sealed('S1', '2026-02-03', 1, { currency: 'USD', rate: null })] }), new Map([[env(1), amounts(1_000)]]));
    expect(out.report!.missingRates).toBe(2);
    expect(out.report!.invoices.map((i) => i.id)).toEqual(['P1']);
  });

  it('gives no report while any document stays shut', () => {
    const docs = [sealed('S1', '2026-02-03', 1), sealed('S2', '2026-02-04', 2), sealed('S3', '2026-02-05', 3, { rate: null })];
    expect(buildSealedNetIncome(inputs({ sealedDocs: docs }), new Map([[env(1), amounts(1_000)]]))).toEqual({ report: null, missing: 2 });
  });

  it('asks only for the sealed envelopes', () => {
    expect(sealedNetIncomeEnvelopes({ sealedDocs: [sealed('S1', '2026-02-03', 1), sealed('S2', '2026-02-03', 2, { encAmounts: 'plain' })] })).toEqual([env(1)]);
  });
});
