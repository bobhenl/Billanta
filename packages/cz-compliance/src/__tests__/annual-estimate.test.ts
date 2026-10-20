import { describe, expect, it } from 'vitest';
import {
  computeOsvcAnnualSummary,
  computeSkSzcoAnnualSummary,
  lookupCzOffices,
  skSocialPremium,
  skTaxParamsFor,
  skTaxpayerAllowance,
  type CzOfficeTable
} from '../index.js';

describe('CZ estimate: edge cases', () => {
  it('caps paušální výdaje at the yearly amount', () => {
    const r = computeOsvcAnnualSummary({ year: 2025, income: 3_000_000, actualExpenses: 0, flatRate: 60 });
    expect(r.flatExpenses).toBe(1_200_000);
    expect(r.profit).toBe(1_800_000);
  });

  it('the paušál cap stays yearly in a part year', () => {
    const r = computeOsvcAnnualSummary({ year: 2025, income: 3_000_000, actualExpenses: 0, flatRate: 60, activeMonths: 3 });
    expect(r.flatExpenses).toBe(1_200_000);
  });

  it('minimum bases count only the months of activity', () => {
    const full = computeOsvcAnnualSummary({ year: 2025, income: 0, actualExpenses: 0, flatRate: null });
    const half = computeOsvcAnnualSummary({ year: 2025, income: 0, actualExpenses: 0, flatRate: null, activeMonths: 6 });
    // 2025: 35 % of 46 557 = 16 295 Kč social, 50 % = 23 279 Kč health per month.
    expect(full.social.base).toBe(12 * 16_295);
    expect(half.social.base).toBe(6 * 16_295);
    expect(half.health.base).toBe(6 * 23_279);
    expect(half.activeMonths).toBe(6);
  });

  it('sleva na poplatníka is a full yearly amount, even for three months', () => {
    const input = { year: 2025, income: 600_000, actualExpenses: 0, flatRate: 60 as const };
    // 240 000 × 15 % = 36 000, minus 30 840.
    expect(computeOsvcAnnualSummary(input).tax.total).toBe(5_160);
    expect(computeOsvcAnnualSummary({ ...input, activeMonths: 3 }).tax.total).toBe(5_160);
    // A low profit does not go below zero.
    expect(computeOsvcAnnualSummary({ ...input, income: 200_000 }).tax.total).toBe(0);
  });

  it('next advances divide the base by the active months', () => {
    const input = { year: 2025, income: 600_000, actualExpenses: 0, flatRate: 60 as const };
    // 55 % of 240 000 = 132 000 over 6 months: 22 000 × 29.2 % = 6 424 Kč, above the 2026 minimum 5 720.
    expect(computeOsvcAnnualSummary({ ...input, activeMonths: 6 }).social.nextAdvance).toBe(6_424);
    // Over a full year the same profit is under the minimum base.
    expect(computeOsvcAnnualSummary(input).social.nextAdvance).toBe(5_720);
    // Health: 50 % of 480 000 over 6 months = 40 000 × 13.5 % = 5 400 Kč.
    expect(computeOsvcAnnualSummary({ ...input, income: 1_200_000, activeMonths: 6 }).health.nextAdvance).toBe(5_400);
  });

  it('treats an invalid month count as a full year', () => {
    for (const m of [0, 13, 2.5, Number.NaN]) {
      expect(computeOsvcAnnualSummary({ year: 2025, income: 0, actualExpenses: 0, flatRate: null, activeMonths: m }).activeMonths).toBe(12);
    }
  });
});

describe('SK estimate', () => {
  const base = { year: 2025, income: 30_000, actualExpenses: 0, flatRate: true, paidSocial: 12 * 237.02, paidHealth: 12 * 107.25 };

  it('a typical 2025 SZČO on paušál: 15 % tax, health at the minimum, social from July 2026', () => {
    const r = computeSkSzcoAnnualSummary(base);
    expect(r.flatExpenses).toBe(18_000);
    // 12 000 − 2 844,24 − 1 287 paid poistné.
    expect(r.tax.base).toBe(7_868.76);
    expect(r.tax.allowance).toBe(5_753.79);
    expect(r.tax.taxable).toBe(2_114.97);
    expect(r.tax.reducedRate).toBe(true);
    expect(r.tax.total).toBe(317.24);
    // 12 000 / 1,486 = 8 075,37 is under 12 × 715.
    expect(r.health.base).toBe(8_580);
    expect(r.health.total).toBe(1_287);
    expect(r.health.balance).toBe(0);
    // 2026 minimum health advance 762 × 16 %.
    expect(r.health.nextAdvance).toBe(121.92);
    expect(r.social).toMatchObject({ fromJuly: 2026, mode: 'normal', monthlyBase: 914.4, monthly: 303.11 });
  });

  it('caps paušálne výdavky at 20 000 € and does not prorate the cap', () => {
    expect(computeSkSzcoAnnualSummary({ ...base, income: 50_000 }).flatExpenses).toBe(20_000);
    expect(computeSkSzcoAnnualSummary({ ...base, income: 50_000, activeMonths: 6 }).flatExpenses).toBe(20_000);
  });

  it('health minimum counts months as SZČO', () => {
    const r = computeSkSzcoAnnualSummary({ ...base, income: 0, paidHealth: 0, activeMonths: 6 });
    expect(r.health.base).toBe(6 * 715);
    expect(r.health.total).toBe(643.5);
  });

  it('NČZD tapers above the threshold, with the 2026 formula', () => {
    const p25 = skTaxParamsFor(2025);
    const p26 = skTaxParamsFor(2026);
    expect(skTaxpayerAllowance(p25, 25_426.27)).toBe(5_753.79);
    expect(skTaxpayerAllowance(p25, 30_000)).toBe(4_610.36); // 12 110,36 − 7 500
    expect(skTaxpayerAllowance(p26, 26_083.13)).toBe(5_966.73);
    expect(skTaxpayerAllowance(p26, 30_000)).toBe(4_661.11); // 14 661,11 − 10 000
    expect(skTaxpayerAllowance(p26, 50_000)).toBe(0);
  });

  it('above the income limit: 19 / 25 % in 2025, four brackets in 2026', () => {
    const high = { income: 120_000, actualExpenses: 20_000, flatRate: false, paidSocial: 0, paidHealth: 0 };
    const r25 = computeSkSzcoAnnualSummary({ ...high, year: 2025 });
    expect(r25.tax.allowance).toBe(0);
    expect(r25.tax.reducedRate).toBe(false);
    expect(r25.tax.total).toBe(22_093.51);
    expect(computeSkSzcoAnnualSummary({ ...high, year: 2026 }).tax.total).toBe(25_593.02);
    // 2024: the 15 % limit was 60 000 €.
    const r24 = computeSkSzcoAnnualSummary({ ...high, year: 2024, income: 70_000, actualExpenses: 50_000 });
    expect(r24.tax.reducedRate).toBe(false);
  });

  it('2026 bands in euros match § 15 písm. a) ZDP as amended by 261/2025 Z. z.', () => {
    const p = skTaxParamsFor(2026);
    const limits = p.brackets.map((b) => (b.upTo == null ? null : Math.round(b.upTo * p.subsistenceMinimum * 100) / 100));
    expect(limits).toEqual([43_983.32, 60_349.21, 75_010.32, null]);
    expect(p.brackets.map((b) => b.rate)).toEqual([0.19, 0.25, 0.3, 0.35]);
  });

  it('social from July 2026: nothing, mikroodvod or the normal regime by income', () => {
    expect(computeSkSzcoAnnualSummary({ ...base, income: 2_500 }).social).toMatchObject({ mode: 'none', monthly: 0 });
    expect(computeSkSzcoAnnualSummary({ ...base, income: 5_000 }).social).toMatchObject({ mode: 'micro', monthly: 131.34 });
    // From July 2025 (2024 income) there was no mikroodvod band.
    expect(computeSkSzcoAnnualSummary({ ...base, year: 2024, income: 5_000 }).social.mode).toBe('none');
    expect(computeSkSzcoAnnualSummary({ ...base, year: 2024, income: 9_000 }).social).toMatchObject({ mode: 'normal', monthly: 237.02 });
  });

  it('social premium rounds each fund down, as the published amounts do', () => {
    expect(skSocialPremium(914.4)).toBe(303.11);
    expect(skSocialPremium(396.24)).toBe(131.34);
    expect(skSocialPremium(715)).toBe(237.02);
  });

  it('a high income hits the maximum social base', () => {
    const r = computeSkSzcoAnnualSummary({ ...base, income: 400_000, flatRate: false, actualExpenses: 0 });
    expect(r.social.monthlyBase).toBe(16_764);
  });
});

describe('lookupCzOffices', () => {
  const table: CzOfficeTable = {
    offices: [
      [452, 2122, 228],
      [453, 0, 0],
      [453, 2208, 336],
      [453, 2201, 332],
      [461, 0, 772],
      [461, 3002, 772]
    ],
    psc: { '25101': 0, '37501': { '*': 1, 'albrechtice nad vltavou': 2, 'tyn nad vltavou': 3 }, '61500': { '*': 4, 'brno-zidenice': 5 } }
  };

  it('a PSČ with one office needs no name', () => {
    expect(lookupCzOffices(table, '251 01', 'whatever')).toEqual({ taxOffice: 452, taxWorkplace: 2122, ossz: '228' });
  });

  it('a split PSČ is decided by the obec name, diacritics and case ignored', () => {
    expect(lookupCzOffices(table, '37501', 'Týn nad Vltavou')).toEqual({ taxOffice: 453, taxWorkplace: 2201, ossz: '332' });
    expect(lookupCzOffices(table, '37501', 'ALBRECHTICE NAD VLTAVOU')?.taxWorkplace).toBe(2208);
    expect(lookupCzOffices(table, '61500', 'Brno - Židenice')?.taxWorkplace).toBe(3002);
    expect(lookupCzOffices(table, '61500', 'Brno, Židenice')?.taxWorkplace).toBe(3002);
    expect(lookupCzOffices(table, '61500', 'Brno-Židenice (Brno-město)')?.taxWorkplace).toBe(3002);
    expect(lookupCzOffices(table, '37501', 'Týn nad Vltavou-Hněvkovice')?.taxWorkplace).toBe(2201);
  });

  it('an unknown name keeps only what all offices agree on', () => {
    expect(lookupCzOffices(table, '37501', 'Neznámá')).toEqual({ taxOffice: 453, taxWorkplace: null, ossz: null });
    expect(lookupCzOffices(table, '61500', 'Brno')).toEqual({ taxOffice: 461, taxWorkplace: null, ossz: '772' });
  });

  it('no or an unknown PSČ gives nothing', () => {
    expect(lookupCzOffices(table, null, 'Praha')).toBeNull();
    expect(lookupCzOffices(table, '99999', 'Praha')).toBeNull();
    expect(lookupCzOffices(table, '1234', 'Praha')).toBeNull();
  });
});
