import { describe, expect, it } from 'vitest';
import {
  applicableMinimums,
  computeOsvcAnnualSummary,
  fitsFlatTaxBand1,
  flatTaxBand1ForYear,
  minimumPeriods,
  minimumsAt,
  minSocialShareIn,
  OSVC_PARAM_YEARS,
  osvcMinSocialAdvance,
  osvcParamsFor,
  parseCnbDay,
  parseCnbRates
} from '../index.js';

describe('OSVČ minimum social base', () => {
  it('2026: 40 % of the average wage until June, 35 % from July', () => {
    const p = osvcParamsFor(2026);
    expect(minSocialShareIn(p, 6)).toBe(0.4);
    expect(minSocialShareIn(p, 7)).toBe(0.35);
    expect(osvcMinSocialAdvance(2026, 1)).toBe(5720);
    expect(osvcMinSocialAdvance(2026, 7)).toBe(5005);
  });

  it('agrees with the statutory minimums table for every month it covers', () => {
    // Two tables, one truth: the yearly maths and the advances suggestion must not drift apart.
    for (const year of OSVC_PARAM_YEARS) {
      for (let m = 1; m <= 12; m++) {
        const month = `${year}-${String(m).padStart(2, '0')}`;
        const social = minimumsAt('CZ', month)?.values.social;
        if (social != null) expect([month, osvcMinSocialAdvance(year, m)]).toEqual([month, social]);
      }
    }
  });

  it('a 2026 minimum payer: yearly base is 6 months at 40 % plus 6 at 35 %', () => {
    const r = computeOsvcAnnualSummary({ year: 2026, income: 0, actualExpenses: 0, flatRate: null });
    // 6 × 19 587 + 6 × 17 139 (a flat 40 % would be 12 × 19 587 = 235 044).
    expect(r.social.base).toBe(220_356);
    expect(r.social.total).toBe(64_344);
    // No 2027 parameters yet: the July share carries forward, so the minimum advance is 5 005.
    expect(r.social.nextAdvance).toBe(5005);
  });

  it('above the minimum the advance still follows the yearly base', () => {
    const r = computeOsvcAnnualSummary({ year: 2026, income: 1_000_000, actualExpenses: 0, flatRate: 60 });
    // Profit 400 000, base 55 % = 220 000 < the 220 356 minimum, so the minimum applies.
    expect(r.social.base).toBe(220_356);
    const high = computeOsvcAnnualSummary({ year: 2026, income: 2_000_000, actualExpenses: 0, flatRate: 60 });
    // Profit 800 000, base 440 000 → 36 667 / month → 10 707 Kč advance.
    expect(high.social.base).toBe(440_000);
    expect(high.social.nextAdvance).toBe(10_707);
  });

  it('years without a mid-year change keep one share', () => {
    const r = computeOsvcAnnualSummary({ year: 2025, income: 0, actualExpenses: 0, flatRate: null });
    expect(r.social.base).toBe(12 * Math.ceil(46_557 * 0.35));
  });
});

describe('applicableMinimums', () => {
  const regime = (flatTax: boolean | null, activity: 'main' | 'secondary' | null = null) => ({ flatTax, activity });

  it('paušální režim fills only the flat tax (it already covers social and health)', () => {
    expect(applicableMinimums('CZ', '2026-03', regime(true))).toEqual({ from: '2026-01', values: { flat_tax: 9984 } });
    expect(applicableMinimums('CZ', '2026-08', regime(true, 'secondary'))).toEqual({ from: '2026-07', values: { flat_tax: 9162 } });
  });

  it('outside it: social and health for a main activity', () => {
    expect(applicableMinimums('CZ', '2026-08', regime(false, 'main'))).toEqual({ from: '2026-07', values: { social: 5005, health: 3306 } });
  });

  it('a secondary activity: the lower social minimum and no health minimum', () => {
    expect(applicableMinimums('CZ', '2026-08', regime(false, 'secondary'))).toEqual({ from: '2026-01', values: { social: 1574 } });
    // 11 % of the 2026 average wage, both steps rounded up (§ 5b odst. 2 zákona č. 589/1992 Sb.).
    expect(Math.ceil(Math.ceil(osvcParamsFor(2026).averageWage * 0.11) * 0.292)).toBe(1574);
  });

  it('asks first instead of guessing', () => {
    expect(applicableMinimums('CZ', '2026-03', regime(null))).toEqual({ ask: 'flat_tax' });
    expect(applicableMinimums('CZ', '2026-03', regime(false))).toEqual({ ask: 'activity' });
  });

  it('SK has no paušální daň: always social and health, no questions', () => {
    expect(applicableMinimums('SK', '2026-03', regime(null))).toEqual({ from: '2026-01', values: { social: 303.11, health: 121.92 } });
  });

  it('a year without figures gives nothing', () => {
    expect(applicableMinimums('CZ', '2027-01', regime(false, 'secondary'))).toBeNull();
    expect(applicableMinimums('CZ', '2027-01', regime(null))).toBeNull();
  });
});

describe('statutory minimums', () => {
  it('splits 2026 into the January and July periods', () => {
    const periods = minimumPeriods('CZ', 2026);
    expect(periods.map((p) => p.from)).toEqual(['2026-01', '2026-07']);
    // July carries health forward and overrides social and paušální daň.
    expect(periods[1]!.values).toEqual({ health: 3306, social: 5005, flat_tax: 9162 });
  });

  it('only answers for a year it knows, never with a stale figure', () => {
    expect(minimumsAt('CZ', '2026-06')!.values.social).toBe(5720);
    expect(minimumsAt('CZ', '2027-01')).toBeNull();
    expect(minimumsAt('SK', '2026-08')!.values.social).toBe(303.11);
  });

  it('paušální daň band 1 for 2026 sums the amounts in force each month', () => {
    expect(flatTaxBand1ForYear(2026)).toBe(6 * 9984 + 6 * 9162);
    expect(flatTaxBand1ForYear(2027)).toBeNull();
  });

  it('band 1 income limits depend on the flat-expense rate (§ 2a ZDP)', () => {
    expect(fitsFlatTaxBand1(1_000_000, 40)).toBe(true);
    expect(fitsFlatTaxBand1(1_200_000, 40)).toBe(false);
    expect(fitsFlatTaxBand1(1_500_000, 60)).toBe(true);
    expect(fitsFlatTaxBand1(1_800_000, 60)).toBe(false);
    expect(fitsFlatTaxBand1(2_000_000, 80)).toBe(true);
    expect(fitsFlatTaxBand1(2_000_001, 80)).toBe(false);
  });
});

describe('ČNB daily list', () => {
  const LIST = '16.10.2026 #201\r\nzemě|měna|množství|kód|kurz\r\nEMU|euro|1|EUR|24,330\r\nJaponsko|jen|100|JPY|15,512\r\n';

  it('reads the publication date and normalises rates to one unit', () => {
    const day = parseCnbDay(LIST)!;
    expect(day.date).toBe('2026-10-16');
    expect(day.rates.get('EUR')).toEqual({ rate: 24.33, country: 'EMU', name: 'euro' });
    expect(parseCnbRates(LIST).get('JPY')).toBeCloseTo(0.15512, 6);
  });

  it('rejects an error page or an empty list', () => {
    expect(parseCnbDay('<html>error</html>')).toBeNull();
    expect(parseCnbDay('16.10.2026 #201\nzemě|měna|množství|kód|kurz\n')).toBeNull();
  });
});
