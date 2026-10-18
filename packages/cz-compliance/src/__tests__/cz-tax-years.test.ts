import { describe, expect, it } from 'vitest';
import { computeOsvcAnnualSummary, CZ_TAX_YEAR_LIST, CZ_TAX_YEARS, flatTaxBandFor, flatTaxMonthly, flatTaxYearTotal, minimumsAt } from '../index.js';

const up = (n: number) => Math.ceil(Math.round(n * 100) / 100);

describe('yearly parameters (cz-tax-years)', () => {
  it('covers 2023 to 2026', () => {
    expect(CZ_TAX_YEAR_LIST).toEqual([2023, 2024, 2025, 2026]);
  });

  // ČSSZ "Výše minimálních vyměřovacích základů OSVČ": yearly minimum bases
  // for main, secondary and starting activity (§ 5b zákona č. 589/1992 Sb.).
  it.each([
    [2023, 120_972, 48_396, null],
    [2024, 158_292, 58_044, 131_904],
    [2025, 195_540, 61_464, 139_680],
    // 2026 main: 12 × 17 139 after the amendment (ČSSZ still lists 235 044 at 40 %).
    [2026, 205_668, 64_644, 146_904],
  ])('%i yearly minimum social bases match ČSSZ', (year, main, secondary, starter) => {
    const y = CZ_TAX_YEARS[year]!;
    expect(12 * up(y.averageWage * y.social.annualMainShare)).toBe(main);
    expect(12 * up(y.averageWage * y.social.secondaryShare)).toBe(secondary);
    expect(y.social.starterShare == null ? null : 12 * up(y.averageWage * y.social.starterShare)).toBe(starter);
  });

  // § 3a zákona č. 592/1992 Sb.: minimum base is half the average wage, 13.5 %.
  it.each([
    [2023, 2722],
    [2024, 2968],
    [2025, 3143],
    [2026, 3306],
  ])('%i minimum health advance', (year, advance) => {
    const y = CZ_TAX_YEARS[year]!;
    expect(up(up(y.averageWage * y.healthMinShare) * 0.135)).toBe(advance);
    expect(minimumsAt('CZ', `${year}-03`)!.values.health).toBe(advance);
  });

  it('paušální daň band 1 contains the minimum social and health advances plus 100 Kč (§ 7a ZDP)', () => {
    for (const year of [2023, 2024, 2025] as const) {
      const y = CZ_TAX_YEARS[year]!;
      // Social part: the minimum base raised by 15 %, at 29.2 %.
      const social = up(up(up(y.averageWage * y.social.mainShare) * 1.15) * 0.292);
      const health = up(up(y.averageWage * y.healthMinShare) * 0.135);
      expect([year, 100 + social + health]).toEqual([year, y.flatTax[1]]);
    }
  });
});

describe('paušální daň (§ 2a, § 7a ZDP)', () => {
  it('2026 band 1 is 9 984 Kč due until June, 9 162 Kč after, settled as 12 × 9 162', () => {
    expect(flatTaxMonthly(2026, 1, 6)).toBe(9984);
    expect(flatTaxMonthly(2026, 1, 7)).toBe(9162);
    expect(flatTaxYearTotal(2026, 1)).toBe(109_944);
    expect(flatTaxYearTotal(2026, 2)).toBe(12 * 16_745);
    expect(flatTaxYearTotal(2023, 3)).toBe(12 * 26_000);
    expect(flatTaxYearTotal(2027, 1)).toBeNull();
  });

  it('picks the lowest band the income fits', () => {
    expect(flatTaxBandFor(1_000_000, 40)).toBe(1);
    expect(flatTaxBandFor(1_200_000, 40)).toBe(2);
    expect(flatTaxBandFor(1_200_000, 60)).toBe(1);
    expect(flatTaxBandFor(1_800_000, 60)).toBe(2);
    expect(flatTaxBandFor(1_800_000, 40)).toBe(3);
    expect(flatTaxBandFor(2_000_000, 80)).toBe(1);
    expect(flatTaxBandFor(2_000_001, 80)).toBeNull();
  });
});

describe('annual summary across years', () => {
  it('2023 uses 50 % of profit for social and 48× the average wage for the 23 % rate', () => {
    // Profit 2 000 000: 23 % only above 1 935 552 Kč in 2023, above 1 582 812 Kč in 2024.
    const r23 = computeOsvcAnnualSummary({ year: 2023, income: 2_000_000, actualExpenses: 0, flatRate: null });
    expect(r23.social.base).toBe(1_000_000);
    expect(r23.tax.beforeCredit).toBe(up(1_935_552 * 0.15 + 64_448 * 0.23));
    const r24 = computeOsvcAnnualSummary({ year: 2024, income: 2_000_000, actualExpenses: 0, flatRate: null });
    expect(r24.social.base).toBe(1_100_000);
    expect(r24.tax.beforeCredit).toBe(up(1_582_812 * 0.15 + 417_188 * 0.23));
  });
});
