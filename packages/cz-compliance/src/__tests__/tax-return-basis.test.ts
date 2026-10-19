import { describe, expect, it } from 'vitest';
import {
  compareFlatTaxRegimes,
  computeOsvcAnnualSummary,
  computeSkSzcoAnnualSummary,
  computeTaxReturnBasis,
  sortExpenseCategories,
  taxReturnDeadlines,
  taxReturnSeason,
  type TaxReturnBasisInput
} from '../index.js';

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const cz = (over: Partial<TaxReturnBasisInput> = {}): TaxReturnBasisInput => ({
  country: 'CZ',
  year: 2025,
  income: 800_000,
  expensesByCategory: { software: 30_000, travel: 20_000, '': 5_000 },
  vatPayer: false,
  legalEntity: false,
  ...over
});

describe('taxReturnDeadlines', () => {
  it('CZ 2025: paper 1 April, electronic 1 May moved past Labour Day to Monday 4 May, advisor 1 July', () => {
    const d = taxReturnDeadlines('CZ', 2025);
    expect(d.map((x) => [x.kind, ymd(x.date)])).toEqual([
      ['paper', '2026-04-01'],
      ['electronic', '2026-05-04'],
      ['advisor', '2026-07-01']
    ]);
  });

  it('CZ 2023: 1 April 2024 is Easter Monday, so paper moves to 2 April', () => {
    expect(ymd(taxReturnDeadlines('CZ', 2023)[0]!.date)).toBe('2024-04-02');
  });

  it('CZ 2026: 1 May 2027 is a Saturday, so electronic moves to Monday 3 May', () => {
    expect(ymd(taxReturnDeadlines('CZ', 2026)[1]!.date)).toBe('2027-05-03');
  });

  it('SK 2025: 31 March, extendable to 30 June (no separate electronic deadline)', () => {
    expect(taxReturnDeadlines('SK', 2025).map((x) => [x.kind, ymd(x.date)])).toEqual([
      ['paper', '2026-03-31'],
      ['extended', '2026-06-30']
    ]);
  });

  it('SK 2023: 31 March 2024 is Easter Sunday and 1 April Easter Monday, so 2 April', () => {
    expect(ymd(taxReturnDeadlines('SK', 2023)[0]!.date)).toBe('2024-04-02');
  });
});

describe('sortExpenseCategories', () => {
  it('merges blank keys into one uncategorised bucket, drops zeros, largest first', () => {
    expect(sortExpenseCategories({ rent: 100, '': 50, ' ': 70, fuel: 0, office: 120.004 })).toEqual([
      { category: 'office', amount: 120 },
      { category: null, amount: 120 },
      { category: 'rent', amount: 100 }
    ]);
  });
});

describe('computeTaxReturnBasis – CZ', () => {
  it('sums the categories and lists all four paušály with their caps', () => {
    const b = computeTaxReturnBasis(cz());
    expect(b.currency).toBe('CZK');
    expect(b.params).toBe(true);
    expect(b.actualExpenses).toBe(55_000);
    expect(b.categories[0]).toEqual({ category: 'software', amount: 30_000 });
    expect(b.categories.at(-1)).toEqual({ category: null, amount: 5_000 });
    expect(b.flatExpenses).toEqual([
      { rate: 80, cap: 1_600_000, amount: 640_000, capped: false },
      { rate: 60, cap: 1_200_000, amount: 480_000, capped: false },
      { rate: 40, cap: 800_000, amount: 320_000, capped: false },
      { rate: 30, cap: 600_000, amount: 240_000, capped: false }
    ]);
    expect(b.chosen).toEqual({ rate: 60, flat: 480_000, actual: 55_000, better: 'flat' });
  });

  it('caps the paušál above 2 million (60 % of 2.5 M = 1.2 M)', () => {
    const b = computeTaxReturnBasis(cz({ income: 2_500_000 }));
    const sixty = b.flatExpenses.find((f) => f.rate === 60)!;
    expect(sixty).toEqual({ rate: 60, cap: 1_200_000, amount: 1_200_000, capped: true });
    expect(b.flatExpenses.find((f) => f.rate === 30)).toEqual({ rate: 30, cap: 600_000, amount: 600_000, capped: true });
  });

  it('actual expenses win when they exceed the paušál', () => {
    const b = computeTaxReturnBasis(cz({ flatRate: 40, expensesByCategory: { material: 400_000 } }));
    expect(b.chosen).toEqual({ rate: 40, flat: 320_000, actual: 400_000, better: 'actual' });
  });

  it('the options match the annual summary and the regime comparison for the same year', () => {
    const b = computeTaxReturnBasis(cz());
    const flat = computeOsvcAnnualSummary({ year: 2025, income: 800_000, actualExpenses: 55_000, flatRate: 60 });
    const actual = computeOsvcAnnualSummary({ year: 2025, income: 800_000, actualExpenses: 55_000, flatRate: null });
    expect(b.options!.map((o) => [o.kind, o.expenses, o.profit])).toEqual([
      ['flat_expenses', flat.expenses, flat.profit],
      ['actual_expenses', actual.expenses, actual.profit]
    ]);
    const cmp = compareFlatTaxRegimes({ year: 2025, income: 800_000, actualExpenses: 55_000, flatRate: 60 })!;
    expect(b.flatTax).toEqual(cmp);
    expect(b.options![0]!.total).toBe(cmp.options.find((o) => o.kind === 'flat_expenses')!.total);
  });

  it('paušální daň is unavailable to a VAT payer', () => {
    const b = computeTaxReturnBasis(cz({ vatPayer: true }));
    const ft = b.flatTax!.options.find((o) => o.kind === 'flat_tax')!;
    expect(ft.available).toBe(false);
    expect(ft.reason).toBe('vat_payer');
  });

  it('a year without published parameters gets sums and deadlines, never a neighbouring year’s numbers', () => {
    const b = computeTaxReturnBasis(cz({ year: 2031 }));
    expect(b.params).toBe(false);
    expect(b.options).toBeNull();
    expect(b.flatTax).toBeNull();
    expect(b.actualExpenses).toBe(55_000);
    expect(b.chosen?.flat).toBe(480_000);
    expect(ymd(b.deadlines[0]!.date)).toBe('2032-04-01');
  });

  it('a company gets only the sums and the deadlines', () => {
    const b = computeTaxReturnBasis(cz({ legalEntity: true }));
    expect(b.legalEntity).toBe(true);
    expect(b.flatExpenses).toEqual([]);
    expect(b.chosen).toBeNull();
    expect(b.options).toBeNull();
    expect(b.flatTax).toBeNull();
    expect(b.income).toBe(800_000);
  });

  it('negative income (more credit notes than invoices) is treated as zero', () => {
    const b = computeTaxReturnBasis(cz({ income: -1_000 }));
    expect(b.income).toBe(0);
    expect(b.chosen?.flat).toBe(0);
  });
});

describe('computeTaxReturnBasis – SK', () => {
  const sk = (over: Partial<TaxReturnBasisInput> = {}) =>
    computeTaxReturnBasis({ country: 'SK', year: 2025, income: 30_000, expensesByCategory: { rent: 6_000 }, vatPayer: false, legalEntity: false, ...over });

  it('one 60 % paušál, in euro', () => {
    const b = sk();
    expect(b.currency).toBe('EUR');
    expect(b.flatExpenses).toEqual([{ rate: 60, cap: 20_000, amount: 18_000, capped: false }]);
    expect(b.chosen).toEqual({ rate: 60, flat: 18_000, actual: 6_000, better: 'flat' });
  });

  it('caps the paušál at 20 000 € (60 % of 40 000 = 24 000)', () => {
    expect(sk({ income: 40_000 }).flatExpenses[0]).toEqual({ rate: 60, cap: 20_000, amount: 20_000, capped: true });
  });

  it('no paušálna daň in Slovakia', () => {
    expect(sk().flatTax).toBeNull();
  });

  it('the options match the SZČO summary, with the poistné paid deducted', () => {
    const b = sk({ paidSocial: 2_000, paidHealth: 1_500 });
    const s = computeSkSzcoAnnualSummary({ year: 2025, income: 30_000, actualExpenses: 6_000, flatRate: true, paidSocial: 2_000, paidHealth: 1_500 });
    expect(b.options![0]!).toEqual({
      kind: 'flat_expenses',
      expenses: s.expenses,
      profit: s.profit,
      tax: s.tax.total,
      social: 2_000,
      health: s.health.total,
      total: s.totalBurden
    });
    expect(b.options![1]!.kind).toBe('actual_expenses');
    expect(b.options![1]!.expenses).toBe(6_000);
  });

  it('a year without SK parameters (2023) gets no estimate', () => {
    const b = sk({ year: 2023 });
    expect(b.params).toBe(false);
    expect(b.options).toBeNull();
    expect(b.chosen?.flat).toBe(18_000);
  });
});

describe('taxReturnSeason', () => {
  it('January to March is about the previous year', () => {
    expect(taxReturnSeason(new Date('2026-01-05T08:00:00Z'))).toEqual({ taxYear: 2025 });
    expect(taxReturnSeason(new Date('2026-03-31T20:00:00Z'))).toEqual({ taxYear: 2025 });
  });

  it('reads the month in Prague time', () => {
    // 31 Dec 23:30 UTC is already 1 January in Prague.
    expect(taxReturnSeason(new Date('2025-12-31T23:30:00Z'))).toEqual({ taxYear: 2025 });
    // 31 March 22:30 UTC is 1 April in Prague (summer time).
    expect(taxReturnSeason(new Date('2026-03-31T22:30:00Z'))).toBeNull();
  });

  it('nothing from April to December', () => {
    expect(taxReturnSeason(new Date('2026-04-15T10:00:00Z'))).toBeNull();
    expect(taxReturnSeason(new Date('2026-10-19T10:00:00Z'))).toBeNull();
  });
});
