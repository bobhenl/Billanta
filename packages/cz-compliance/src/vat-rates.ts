/**
 * Current VAT rates for the public VAT calculator (and anything else that
 * needs "which rates exist in CZ / SK today"). Rates change with tax reforms,
 * so each country carries the date its current set has applied from:
 *
 * - CZ: 21 % and 12 % since 1. 1. 2024 (the 10 % and 15 % rates merged into
 *   12 %, konsolidační balíček), zákon č. 235/2004 Sb. § 47.
 * - SK: 23 %, 19 % and 5 % since 1. 1. 2025 (zákon č. 222/2004 Z. z. § 27).
 */
export type VatCountry = 'CZ' | 'SK';

export const VAT_RATES: Record<VatCountry, { since: string; rates: readonly number[] }> = {
  CZ: { since: '2024-01-01', rates: [21, 12, 0] },
  SK: { since: '2025-01-01', rates: [23, 19, 5, 0] }
};

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** VAT on top of a base without VAT ("základ" → "s DPH"), rounded to haléře / cents. */
export function vatFromBase(base: number, rate: number): { base: number; vat: number; gross: number } {
  const vat = round2((base * rate) / 100);
  return { base: round2(base), vat, gross: round2(base + vat) };
}

/**
 * VAT contained in a price with VAT ("s DPH" → "základ"). Since 2019 Czech
 * law computes it as gross − gross / (1 + rate), no more "koeficient"
 * rounded to four places (§ 37 ZDPH).
 */
export function vatFromGross(gross: number, rate: number): { base: number; vat: number; gross: number } {
  const base = round2(gross / (1 + rate / 100));
  return { base, vat: round2(gross - base), gross: round2(gross) };
}
