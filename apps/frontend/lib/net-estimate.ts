// Marginal Czech OSVČ burden on profit: 15 % income tax, social 29.2 % of 55 %,
// health 13.5 % of 50 %. Matches the yearly estimate in Exports, without the
// minimums, the 23 % band and the taxpayer credit — it is "what this extra
// invoice costs you", not the whole year.
const INCOME_TAX = 0.15;
const MARGINAL_ON_PROFIT = INCOME_TAX + 0.55 * 0.292 + 0.5 * 0.135;

// `costs` are what the payment lost on the way (provider fees, conversion). They
// always leave your pocket, but lower the profit only without a flat rate:
// paušální výdaje already stand in for every real expense.
export function netAfterTaxes(base: number, flatRate: number, costs = 0) {
  const profit = flatRate ? Math.max(0, base) * (1 - flatRate / 100) : Math.max(0, base - costs);
  const burden = Math.round(profit * MARGINAL_ON_PROFIT * 100) / 100;
  // Insurance is the rest of the burden, so the two lines add up to it exactly.
  const tax = Math.round(profit * INCOME_TAX * 100) / 100;
  return { net: Math.round((base - costs - burden) * 100) / 100, burden, tax, insurance: Math.round((burden - tax) * 100) / 100 };
}
