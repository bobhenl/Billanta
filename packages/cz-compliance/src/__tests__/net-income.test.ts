import { describe, expect, it } from 'vitest';
import {
  buildSealedNetIncome,
  computeNetIncome,
  netIncomeAmountOf,
  netIncomeReportOf,
  netIncomeSecondaryMonths,
  netIncomeSpanOf,
  sealedNetIncomeEnvelopes,
  type DocumentAmounts,
  type NetIncomeActivity,
  type NetIncomeInputs,
  type NetIncomeInvoice,
  type NetIncomeItem,
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
  fees: 0,
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

  it('taxes the invoiced amount and takes the fees off the net only, split like their invoice', () => {
    const paid = plain('P2', '2026-02-20', 50_000, { currency: 'EUR', amount: 2_000, fees: 1_500, source: 'received', partnerShares: { b: 1 } });
    const withFees = netIncomeReportOf(inputs({ invoices: [plain('P1', '2026-01-15', 100_000), paid] }));
    const without = netIncomeReportOf(inputs({ invoices: [plain('P1', '2026-01-15', 100_000), { ...paid, fees: 0 }] }));
    const [a, b] = withFees.result.partners;
    expect(b!.income).toBe(without.result.partners[1]!.income);
    expect(b!.taxes).toBe(without.result.partners[1]!.taxes);
    expect([a!.fees, b!.fees]).toEqual([0, 1_500]);
    expect(b!.net).toBe(without.result.partners[1]!.net - 1_500);
    expect(withFees.result.totals.fees).toBe(1_500);
    expect(withFees.byMonth!.map((m) => m.fees)).toEqual([0, 1_500, 0]);
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

describe('computeNetIncome in a secondary activity', () => {
  const year = (secondary: boolean) => ({ ...rates, tax_scope: 'one_person' as const, tax_credits: 30_840, secondary_activity: secondary, partners: {} });
  const one = (secondary: boolean, y = 2026): NetIncomeTaxModel => ({ ...model, shared_expenses: [], extra_income: [], years: { [y]: year(secondary) } });
  const yearSpan = (y = 2026) => ({ year: y, month: 1, months: 12 });

  it('drops social insurance while the profit stays under the rozhodná částka', () => {
    // 290 000 income → 116 000 profit, under 117 521 in 2026.
    const r = computeNetIncome(one(true), [{ amount: 290_000, shares: null }], yearSpan());
    expect(r.totals.base).toBe(116_000);
    expect(r.totals.social).toBe(0);
    expect(r.totals.health).toBe(7_830);
  });

  it('keeps social insurance from the rozhodná částka up', () => {
    // 300 000 income → 120 000 profit, over the threshold.
    const r = computeNetIncome(one(true), [{ amount: 300_000, shares: null }], yearSpan());
    expect(r.totals.social).toBe(19_272);
  });

  it('counts social insurance for a main activity whatever the profit', () => {
    const r = computeNetIncome(one(false), [{ amount: 290_000, shares: null }], yearSpan());
    expect(r.totals.social).toBe(18_630);
  });

  it('prorates the threshold for a month', () => {
    // 9 794 Kč is a twelfth of the 2026 threshold; 25 000 income → 10 000 profit.
    const month = { year: 2026, month: 3, months: 1 };
    expect(computeNetIncome(one(true), [{ amount: 24_000, shares: null }], month).totals.social).toBe(0);
    expect(computeNetIncome(one(true), [{ amount: 25_000, shares: null }], month).totals.social).toBe(1_606);
  });

  it('keeps social insurance in a year without a known threshold', () => {
    const r = computeNetIncome(one(true, 2031), [{ amount: 100_000, shares: null }], yearSpan(2031));
    expect(r.totals.social).toBeGreaterThan(0);
  });
});

describe('vedlejší činnost from company settings', () => {
  const year = (legacy: boolean) => ({ ...rates, tax_scope: 'one_person' as const, tax_credits: 30_840, secondary_activity: legacy, partners: {} });
  const one = (legacy = false): NetIncomeTaxModel => ({ ...model, shared_expenses: [], extra_income: [], years: { 2026: year(legacy) } });
  const whole = { year: 2026, month: 1, months: 12 };
  const secondary = (from: string | null, to: string | null): NetIncomeActivity => ({ kind: 'secondary', from, to });
  const income = (amount: number) => [{ amount, shares: null }];
  const flags = (s: string) => [...s].map((c) => c === 'x');

  it('lists the months touched by the period and the months not wholly inside it', () => {
    const r = netIncomeSecondaryMonths(secondary('2025-09-01', '2026-06-15'), one(), 2026);
    expect(r.source).toBe('settings');
    expect(r.secondary).toEqual(flags('xxxxxx......'));
    // June is partly secondary and partly main: it counts for both.
    expect(r.main).toEqual(flags('.....xxxxxxx'));
  });

  it('takes a period ending on the last day of the month as covering it, leap years too', () => {
    expect(netIncomeSecondaryMonths(secondary(null, '2026-02-28'), one(), 2026).main).toEqual(flags('..xxxxxxxxxx'));
    expect(netIncomeSecondaryMonths(secondary(null, '2028-02-28'), one(), 2028).main).toEqual(flags('.xxxxxxxxxxx'));
    expect(netIncomeSecondaryMonths(secondary(null, '2028-02-29'), one(), 2028).main).toEqual(flags('..xxxxxxxxxx'));
    expect(netIncomeSecondaryMonths(secondary('2026-03-10', null), one(), 2026)).toMatchObject({ secondary: flags('..xxxxxxxxxx'), main: flags('xxx.........') });
  });

  it('reads the old report switch as a whole year only while settings say nothing', () => {
    expect(netIncomeSecondaryMonths(null, one(true), 2026)).toMatchObject({ source: 'legacy', secondary: flags('xxxxxxxxxxxx') });
    expect(netIncomeSecondaryMonths({ kind: null, from: null, to: null }, one(false), 2026)).toMatchObject({ source: 'none', secondary: flags('............') });
    expect(netIncomeSecondaryMonths({ kind: 'main', from: null, to: null }, one(true), 2026)).toMatchObject({ source: 'settings', secondary: flags('............') });
  });

  it('drops social insurance for a whole year of secondary activity under the rozhodná částka', () => {
    // 290 000 income → 116 000 profit, under 117 521 in 2026.
    expect(computeNetIncome(one(), income(290_000), whole, secondary(null, null)).totals.social).toBe(0);
  });

  it('lets a main activity in settings win over the old report switch', () => {
    expect(computeNetIncome(one(true), income(290_000), whole, { kind: 'main', from: null, to: null }).totals.social).toBe(18_630);
  });

  it('insures only the main months when the secondary half year stays under the reduced částka', () => {
    // Jan–Jun secondary: 117 521 − 6 × 9 794 = 58 757; half of the 116 000 profit is 58 000, under it.
    // § 5b: only 6/12 of the profit is insured → 58 000 × 55 % × 29.2 %.
    const r = computeNetIncome(one(), income(290_000), whole, secondary(null, '2026-06-30'));
    expect(r.totals.social).toBe(9_315);
  });

  it('reduces the částka by twelfths rounded up, not by a plain share', () => {
    // 293 790 income → 117 516 profit; half is 58 758, just over 58 757 (a plain half of the částka would be 58 760.5).
    const r = computeNetIncome(one(), income(293_790), whole, secondary(null, '2026-06-30'));
    expect(r.totals.base).toBe(117_516);
    expect(r.totals.social).toBe(18_873);
  });

  it('tests a month on its own: a secondary month goes free, a main or mixed month is insured', () => {
    const activity = secondary(null, '2026-06-15');
    const month = (m: number) => computeNetIncome(one(), income(20_000), { year: 2026, month: m, months: 1 }, activity).totals.social;
    // 20 000 → 8 000 profit, under a twelfth of the částka.
    expect(month(3)).toBe(0);
    expect(month(6)).toBe(1_285);
    expect(month(7)).toBe(1_285);
  });

  it('keeps full social insurance in a year the secondary period does not reach', () => {
    expect(computeNetIncome(one(true), income(290_000), whole, secondary('2027-01-01', null)).totals.social).toBe(18_630);
  });

  it('builds the report, its months and the sealed report with the settings', () => {
    const activity = secondary(null, '2026-03-31');
    const q1 = inputs({ model: one(), activity, invoices: [plain('P1', '2026-01-15', 9_000)] });
    const r = netIncomeReportOf(q1);
    expect(r.secondary.secondary).toEqual(flags('xxx.........'));
    expect(r.result.totals.social).toBe(0);
    // 9 000 → 3 600 profit: only health insurance, in the quarter and in January alone.
    expect(r.result.totals.taxes).toBe(243);
    expect(r.byMonth![0]!.taxes).toBe(243);
    const sealedOut = buildSealedNetIncome(inputs({ model: one(), activity, invoices: [], sealedDocs: [sealed('S1', '2026-01-15', 1)] }), new Map([[env(1), amounts(9_000, 0)]]));
    expect(sealedOut.report!.result.totals.social).toBe(0);
  });
});

describe('actual payments of a year', () => {
  type Actuals = Pick<NetIncomeTaxModel['years'][string], 'actual_tax' | 'actual_social' | 'actual_health' | 'actual_refund'>;
  const year2024 = (actual: Actuals = {}, scope: 'one_person' | 'per_partner' = 'one_person') => ({
    ...rates,
    tax_scope: scope,
    tax_credits: 30_840,
    partners: {},
    ...actual,
  });
  // Equal default shares, but A brings 70 % of the income: an even split would give each half.
  const pairModel = (actual?: Actuals, scope?: 'one_person' | 'per_partner'): NetIncomeTaxModel => ({
    ...model,
    shared_expenses: [],
    extra_income: [],
    years: { 2024: year2024(actual, scope) },
  });
  const income: NetIncomeItem[] = [
    { amount: 700_000, shares: { a: 1 } },
    { amount: 300_000, shares: { b: 1 } },
  ];
  const year = { year: 2024, month: 1, months: 12 };
  const sheet = { actual_tax: 11_220, actual_social: 22_856, actual_health: 6_162 };

  it('leaves the estimate alone when nothing is entered', () => {
    const r = computeNetIncome(pairModel(), income, year);
    expect(r.actual).toBeNull();
    expect(r.totals.refund).toBe(0);
    expect(r.totals.taxes).toBe(r.totals.incomeTax + r.totals.social + r.totals.health);
    expect(r.totals.social).not.toBe(22_856);
  });

  it('replaces the estimate and splits it by each partner’s income, not by the default shares', () => {
    const r = computeNetIncome(pairModel(sheet), income, year);
    expect(r.actual).toEqual({ incomeTax: true, social: true, health: true, refund: false });
    expect(r.partners.map((p) => p.incomeTax)).toEqual([7_854, 3_366]);
    expect(r.partners.map((p) => p.social)).toEqual([15_999, 6_857]);
    expect(r.partners.map((p) => p.health)).toEqual([4_313, 1_849]);
    expect(r.totals.taxes).toBe(11_220 + 22_856 + 6_162);
    expect(r.partners.map((p) => p.net)).toEqual([700_000 - 7_854 - 15_999 - 4_313, 300_000 - 3_366 - 6_857 - 1_849]);
    // A whole year takes all of it, whatever income it is measured against.
    expect(computeNetIncome(pairModel(sheet), income, year, null, 4_000_000).totals.social).toBe(22_856);
  });

  it('takes each actual amount on its own', () => {
    const estimate = computeNetIncome(pairModel(), income, year);
    const r = computeNetIncome(pairModel({ actual_social: 22_856 }), income, year);
    expect(r.actual).toEqual({ incomeTax: false, social: true, health: false, refund: false });
    expect(r.totals.social).toBe(22_856);
    expect(r.partners.map((p) => p.incomeTax)).toEqual(estimate.partners.map((p) => p.incomeTax));
    expect(r.partners.map((p) => p.health)).toEqual(estimate.partners.map((p) => p.health));
    expect(r.totals.taxes).toBe(estimate.totals.incomeTax + 22_856 + estimate.totals.health);

    const health = computeNetIncome(pairModel({ actual_health: 6_162 }), income, year);
    expect(health.totals.health).toBe(6_162);
    expect(health.totals.social).toBe(estimate.totals.social);
    expect(health.totals.incomeTax).toBe(estimate.totals.incomeTax);

    const tax = computeNetIncome(pairModel({ actual_tax: 11_220 }), income, year);
    expect(tax.totals.incomeTax).toBe(11_220);
    expect(tax.totals.social).toBe(estimate.totals.social);
  });

  it('shares a refund or a doplatek out by the same income shares', () => {
    const back = computeNetIncome(pairModel({ ...sheet, actual_refund: -3_000 }), income, year);
    expect(back.actual!.refund).toBe(true);
    expect(back.partners.map((p) => p.refund)).toEqual([-2_100, -900]);
    expect(back.totals.taxes).toBe(11_220 + 22_856 + 6_162 - 3_000);
    const extra = computeNetIncome(pairModel({ actual_refund: 1_000 }), income, year);
    expect(extra.partners.map((p) => p.refund)).toEqual([700, 300]);
    expect(extra.totals.taxes).toBe(computeNetIncome(pairModel(), income, year).totals.taxes + 1_000);
  });

  it('belongs to its own year only, not to a later one inheriting the settings', () => {
    const r = computeNetIncome(pairModel(sheet), income, { year: 2025, month: 1, months: 12 });
    expect(r.actual).toBeNull();
    expect(r.totals.taxes).toBe(computeNetIncome(pairModel(), income, { year: 2025, month: 1, months: 12 }).totals.taxes);
  });

  it('counts with one partner, but not when several are taxed each on their own', () => {
    expect(computeNetIncome(pairModel(sheet, 'per_partner'), income, year).actual).toBeNull();
    const solo: NetIncomeTaxModel = { ...pairModel(sheet, 'per_partner'), partners: [model.partners[0]!] };
    expect(computeNetIncome(solo, income, year).totals.social).toBe(22_856);
  });

  describe('in a month or a quarter', () => {
    const paid = { actual_tax: 10_000, actual_social: 20_000, actual_health: 5_000 };
    // 40 % of the year's income in January, 60 % in March.
    const invoices = [plain('J1', '2024-01-10', 300_000, { partnerShares: { a: 1 } }), plain('J2', '2024-01-20', 100_000, { partnerShares: { b: 1 } }), plain('M1', '2024-03-05', 600_000)];
    const yearInputs = (over: Partial<NetIncomeInputs> = {}): NetIncomeInputs =>
      wire({
        period: { year: 2024, month: null, quarter: null, months: 12, from: '2024-01-01', to: '2025-01-01' },
        vatPayer: true,
        model: pairModel(paid),
        invoices,
        missingRates: 0,
        sealedDocs: [],
        ...over,
      });
    const january = { year: 2024, month: 1, quarter: null, months: 1, from: '2024-01-01', to: '2024-02-01' };

    it('gives each month of the year its share of the year’s income', () => {
      const r = netIncomeReportOf(yearInputs());
      expect(r.result.totals.taxes).toBe(35_000);
      // An even spread would put 2 917 into every month.
      expect(r.byMonth!.map((m) => m.taxes)).toEqual([14_000, 0, 21_000, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    });

    it('prorates a month by the year income the server sends, split by that month’s income', () => {
      const r = netIncomeReportOf(yearInputs({ period: january, invoices: invoices.slice(0, 2), yearIncome: { invoices: 1_000_000, sealedDocs: [] } }));
      expect(r.result.totals.taxes).toBe(14_000);
      expect(r.result.partners.map((p) => p.taxes)).toEqual([10_500, 3_500]);
      expect(r.result.partners.map((p) => p.social)).toEqual([6_000, 2_000]);
    });

    it('counts the year’s extra income in what the month is measured against', () => {
      const withFee = pairModel(paid);
      withFee.extra_income = [{ date: '2024-07-01', label: 'Poplatek', amount: 600_000, shares: null }];
      const r = netIncomeReportOf(yearInputs({ model: withFee, period: january, invoices: invoices.slice(0, 2), yearIncome: { invoices: 1_000_000, sealedDocs: [] } }));
      expect(r.result.totals.taxes).toBe(8_750);
    });

    it('spreads the year evenly when its income is not known or is nothing', () => {
      const unknown = netIncomeReportOf(yearInputs({ period: january, invoices: invoices.slice(0, 2) }));
      expect(unknown.result.totals.taxes).toBe(2_917);
      const none = netIncomeReportOf(yearInputs({ period: january, invoices: [], yearIncome: { invoices: 0, sealedDocs: [] } }));
      expect(none.result.totals.taxes).toBe(2_917);
    });

    it('adds the year’s sealed documents in the browser, and waits for every one of them', () => {
      const yearIncome = { invoices: 400_000, sealedDocs: [{ documentType: 'invoice' as const, encAmounts: env(1), rate: 1 }] };
      const out = buildSealedNetIncome(yearInputs({ period: january, invoices: invoices.slice(0, 2), yearIncome }), new Map([[env(1), amounts(600_000)]]));
      expect(out.report!.result.totals.taxes).toBe(14_000);
      expect(sealedNetIncomeEnvelopes({ sealedDocs: [], yearIncome })).toEqual([env(1)]);
      expect(buildSealedNetIncome(yearInputs({ period: january, yearIncome }), new Map())).toEqual({ report: null, missing: 1 });
    });
  });
});
