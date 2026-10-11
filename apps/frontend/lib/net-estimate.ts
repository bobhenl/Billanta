// Marginal Czech OSVČ burden on profit: 15 % income tax, social 29.2 % of 55 %,
// health 13.5 % of 50 %. Matches the yearly estimate in Exports, without the
// minimums, the 23 % band and the taxpayer credit — it is "what this extra
// invoice costs you", not the whole year.
const MARGINAL_ON_PROFIT = 0.15 + 0.55 * 0.292 + 0.5 * 0.135;

export function netAfterTaxes(base: number, flatRate: number) {
  const profit = Math.max(0, base) * (1 - flatRate / 100);
  const burden = Math.round(profit * MARGINAL_ON_PROFIT * 100) / 100;
  return { net: Math.round((base - burden) * 100) / 100, burden };
}
