import { describe, expect, it } from 'vitest';
import {
  TAX_DEADLINE_KINDS,
  applyTaxActivity,
  defaultTaxDeadlineKinds,
  isLegalEntityName,
  relevantTaxDeadlineKinds,
  taxDeadlinesFor,
  type TaxProfile
} from '../tax-deadlines.js';

const profile = (o: Partial<TaxProfile> = {}): TaxProfile => ({ country: 'CZ', vatStatus: 'payer', legalEntity: false, ...o });
const all = [...TAX_DEADLINE_KINDS];

describe('relevantTaxDeadlineKinds', () => {
  it('payer: regular VAT return, KH and souhrnné hlášení, no identified-person return', () => {
    const kinds = relevantTaxDeadlineKinds(all, profile());
    expect(kinds).toEqual(expect.arrayContaining(['vat_monthly', 'vat_quarterly', 'vat_other', 'ec_sales_list', 'health', 'social']));
    expect(kinds).not.toContain('vat_identified');
  });

  it('identified person: own return and souhrnné hlášení only', () => {
    const kinds = relevantTaxDeadlineKinds(all, profile({ vatStatus: 'identified' }));
    expect(kinds.filter((k) => k.startsWith('vat_') || k === 'ec_sales_list')).toEqual(['vat_identified', 'ec_sales_list']);
  });

  it('non-payer: no VAT deadlines at all', () => {
    const kinds = relevantTaxDeadlineKinds(all, profile({ vatStatus: 'non_payer' }));
    expect(kinds.filter((k) => k.startsWith('vat_') || k === 'ec_sales_list')).toEqual([]);
    expect(kinds).toContain('social');
  });

  it('company: no OSVČ advances, flat tax or overviews', () => {
    const kinds = relevantTaxDeadlineKinds(all, profile({ legalEntity: true }));
    for (const k of ['health', 'social', 'flat_tax', 'overviews'] as const) expect(kinds).not.toContain(k);
    expect(kinds).toContain('payroll');
    expect(relevantTaxDeadlineKinds(all, profile())).toEqual(expect.arrayContaining(['health', 'social', 'flat_tax', 'overviews']));
  });

  it('Slovakia: no Czech flat tax and overviews, insurance advances stay', () => {
    const kinds = relevantTaxDeadlineKinds(all, profile({ country: 'SK' }));
    expect(kinds).not.toContain('flat_tax');
    expect(kinds).not.toContain('overviews');
    expect(kinds).toContain('health');
  });
});

describe('defaultTaxDeadlineKinds', () => {
  it('follows the VAT status, and still takes the legacy boolean', () => {
    expect(defaultTaxDeadlineKinds('payer').slice(0, 2)).toEqual(['vat_monthly', 'ec_sales_list']);
    expect(defaultTaxDeadlineKinds('identified').slice(0, 2)).toEqual(['vat_identified', 'ec_sales_list']);
    expect(defaultTaxDeadlineKinds('non_payer')).toEqual(['health', 'social', 'income_tax', 'overviews']);
    expect(defaultTaxDeadlineKinds(true)).toEqual(defaultTaxDeadlineKinds('payer'));
    expect(defaultTaxDeadlineKinds(false)).toEqual(defaultTaxDeadlineKinds('non_payer'));
  });

  it('paušální režim: the flat tax instead of insurance advances, return and overviews', () => {
    expect(defaultTaxDeadlineKinds('non_payer', true)).toEqual(['flat_tax']);
    expect(defaultTaxDeadlineKinds('identified', true)).toEqual(['vat_identified', 'ec_sales_list', 'flat_tax']);
    expect(defaultTaxDeadlineKinds('non_payer', false)).toEqual(['health', 'social', 'income_tax', 'overviews']);
    expect(defaultTaxDeadlineKinds('non_payer', null)).toEqual(defaultTaxDeadlineKinds('non_payer'));
    expect(defaultTaxDeadlineKinds('non_payer', true, 'cz')).toEqual(['flat_tax']);
  });

  it('ignores a leftover paušální režim answer for a Slovak SZČO', () => {
    const kinds = defaultTaxDeadlineKinds('non_payer', true, 'sk');
    expect(kinds).toEqual(['health', 'social', 'income_tax', 'overviews']);
    // After the SK filter the advances are still there.
    const sk = profile({ country: 'SK', vatStatus: 'non_payer', flatTax: true });
    expect(relevantTaxDeadlineKinds(kinds, sk)).toEqual(['health', 'social', 'income_tax']);
  });
});

describe('taxDeadlinesFor', () => {
  // 1 Oct 2026; 25 Oct is a Sunday → 26 Oct (covers September).
  const today = new Date(2026, 9, 1);
  const kinds = ['vat_identified', 'ec_sales_list'] as const;

  it('shifts the 25th to the next working day', () => {
    const [first] = taxDeadlinesFor(kinds, profile({ vatStatus: 'identified' }), null, today, 30);
    expect(first?.date).toEqual(new Date(2026, 9, 26));
  });

  it('identified person: return plain with a foreign purchase that month, "only if" for a regular buyer, gone for someone who never buys abroad', () => {
    const none = profile({ vatStatus: 'identified', activity: { euSalesMonths: [], foreignPurchaseMonths: [] } });
    expect(taxDeadlinesFor(kinds, none, null, today, 30)).toEqual([]);
    const earlier = profile({ vatStatus: 'identified', activity: { euSalesMonths: [], foreignPurchaseMonths: ['2026-03'] } });
    expect(taxDeadlinesFor(kinds, earlier, null, today, 30).map((d) => [d.kind, !!d.conditional])).toEqual([['vat_identified', true]]);
    const unknown = profile({ vatStatus: 'identified' });
    expect(taxDeadlinesFor(kinds, unknown, null, today, 30).map((d) => [d.kind, !!d.conditional])).toEqual([
      ['vat_identified', true],
      ['ec_sales_list', true]
    ]);
    const seen = profile({ vatStatus: 'identified', activity: { euSalesMonths: ['2026-09'], foreignPurchaseMonths: ['2026-09'] } });
    expect(taxDeadlinesFor(kinds, seen, null, today, 30).map((d) => [d.kind, !!d.conditional])).toEqual([
      ['vat_identified', false],
      ['ec_sales_list', false]
    ]);
  });

  it('souhrnné hlášení: only for a month with an EU service, the month before the deadline', () => {
    const august = profile({ activity: { euSalesMonths: ['2026-08'], foreignPurchaseMonths: [] } });
    expect(taxDeadlinesFor(['ec_sales_list'], august, null, today, 30)).toEqual([]);
    const unknown = profile();
    expect(taxDeadlinesFor(['ec_sales_list'], unknown, null, today, 30).map((d) => d.conditional)).toEqual([true]);
  });

  it('non-payer gets nothing even with VAT kinds chosen', () => {
    expect(taxDeadlinesFor(['vat_monthly', 'vat_identified', 'ec_sales_list'], profile({ vatStatus: 'non_payer' }), null, today, 30)).toEqual([]);
  });

  it('leaves other kinds alone', () => {
    const d = { kind: 'social' as const, date: new Date(2026, 9, 20), daysLeft: 19 };
    expect(applyTaxActivity([d], profile({ activity: { euSalesMonths: [], foreignPurchaseMonths: [] } }))).toEqual([d]);
  });
});

describe('isLegalEntityName', () => {
  it('tells a company from an OSVČ by the legal form', () => {
    for (const n of ['Firma s.r.o.', 'Firma, spol. s r.o.', 'Firma a.s.', 'Firma s. r. o.', 'Bytové družstvo', 'Firma k.s.']) expect(isLegalEntityName(n)).toBe(true);
    for (const n of ['Jan Novák', 'Jan Novák – grafika', '', null]) expect(isLegalEntityName(n)).toBe(false);
  });
});
