/**
 * Rough annual figures for a Slovak sole trader (SZČO, § 6 ods. 1 a 2
 * zákona č. 595/2003 Z. z. o dani z príjmov): income tax, health insurance
 * (ročné zúčtovanie) and the social insurance regime from 1 July of the next
 * year. It is a planning estimate like computeOsvcAnnualSummary: no other
 * income, no spouse or pension NČZD, no daňový bonus, no losses.
 *
 * Amounts are euros. Sources, by number:
 * - ŽM (životné minimum) on 1 January: 268,88 € (2024), 273,99 € (2025),
 *   284,13 € (2026); Finančná správa, "Nezdaniteľná časť základu dane na
 *   daňovníka za rok 2025 / 2026" (podpora.financnasprava.sk 844317, 214187).
 * - NČZD (§ 11 ods. 2 ZDP): 21 × ŽM up to 92,8 × ŽM of ZD, above that
 *   44,2 × ŽM − ZD / 4 (2024, 2025). From 2026 zákon č. 261/2025 Z. z.
 *   (Čl. VIII) cut the threshold to 91,8 × ŽM and changed the taper to
 *   51,6 × ŽM − ZD / 3 (consolidated text on slov-lex.sk, 1. 1. 2026).
 * - Rates (§ 15 písm. a) ZDP): 15 % of the whole base when business income
 *   is at most 60 000 € (2024) / 100 000 € (2025 on, Finančná správa
 *   "Sadzba dane ... za rok 2025", 353281); otherwise 19 % up to 176,8 × ŽM
 *   and 25 % above (2024, 2025). From 2026 (zákon č. 261/2025 Z. z.,
 *   § 52zzzj ods. 1): 19 % up to 154,8 × ŽM, 25 % up to 212,4 ×, 30 % up to
 *   264 ×, 35 % above (Finančná správa 081400).
 * - Paušálne výdavky (§ 6 ods. 10 ZDP): 60 % of income, at most 20 000 € a
 *   year, plus the poistné actually paid. The text has no monthly cap for a
 *   part year, so the cap is not prorated.
 * - Health (zákon č. 580/2004 Z. z., § 13 ods. 2): base = ZD before the paid
 *   poistné / 1,486, at least the minimum base per month as SZČO; rate 14 %
 *   (2024), 15 % (2025), 16 % (2026, § 38ezk). Minimum base 652 / 715 / 762 €.
 * - Social (zákon č. 461/2003 Z. z., § 138 ods. 2): from 1 July of the next
 *   year SZČO pays when last year's income exceeds the threshold; base =
 *   (ZD before poistné) / 1,486 / months, between the minimum and the
 *   maximum base; 33,15 % split into 4,4 + 18 + 6 + 4,75 %, each rounded
 *   down to cents (that is how the published 303,11 € and 131,34 € come out).
 *   From July 2026 a "mikroodvod" band applies (MPSVR SR, "Zmeny od 1. júla
 *   2026"): income up to 10,5 × ŽM pays nothing, up to 12 × 762 € pays from
 *   a fixed base of 396,24 €.
 */

export interface SkTaxYearParams {
  /** Životné minimum on 1 January of the year (€ / month). */
  subsistenceMinimum: number;
  /** NČZD: full 21 × ŽM while ZD ≤ `nczdLimit` × ŽM, then `nczdTaper` × ŽM − ZD / `nczdDivisor`. */
  nczdLimit: number;
  nczdTaper: number;
  nczdDivisor: number;
  /** Progressive brackets on the taxable base: up to `upTo` × ŽM (null = rest) at `rate`. */
  brackets: readonly { upTo: number | null; rate: number }[];
  /** 15 % applies to the whole base when business income is at most this (€). */
  reducedRateLimit: number;
  health: { rate: number; minBase: number };
}

/** Social insurance rules in force from 1 July of the keyed year (decided from the previous year's income). */
export interface SkSocialRegime {
  minBase: number;
  maxBase: number;
  /** Income above this means the normal regime. */
  threshold: number;
  /** 2026 on: income above `from` (but under `threshold`) pays from a fixed base. */
  micro?: { from: number; base: number };
}

export const SK_TAX_YEARS: Record<number, SkTaxYearParams> = {
  2024: {
    subsistenceMinimum: 268.88,
    nczdLimit: 92.8,
    nczdTaper: 44.2,
    nczdDivisor: 4,
    brackets: [
      { upTo: 176.8, rate: 0.19 },
      { upTo: null, rate: 0.25 },
    ],
    reducedRateLimit: 60_000,
    health: { rate: 0.14, minBase: 652 },
  },
  2025: {
    subsistenceMinimum: 273.99,
    nczdLimit: 92.8,
    nczdTaper: 44.2,
    nczdDivisor: 4,
    brackets: [
      { upTo: 176.8, rate: 0.19 },
      { upTo: null, rate: 0.25 },
    ],
    reducedRateLimit: 100_000,
    health: { rate: 0.15, minBase: 715 },
  },
  2026: {
    subsistenceMinimum: 284.13,
    nczdLimit: 91.8,
    nczdTaper: 51.6,
    nczdDivisor: 3,
    brackets: [
      { upTo: 154.8, rate: 0.19 },
      { upTo: 212.4, rate: 0.25 },
      { upTo: 264, rate: 0.3 },
      { upTo: null, rate: 0.35 },
    ],
    reducedRateLimit: 100_000,
    health: { rate: 0.16, minBase: 762 },
  },
};

export const SK_SOCIAL_FROM_JULY: Record<number, SkSocialRegime> = {
  // 2024 values (50 % / 7 × of the 2022 average wage 1 304 €); the threshold is 12 × the minimum base.
  2024: { minBase: 652, maxBase: 9_128, threshold: 7_824 },
  2025: { minBase: 715, maxBase: 15_730, threshold: 8_580 },
  2026: { minBase: 914.4, maxBase: 16_764, threshold: 9_144, micro: { from: 2_876.9, base: 396.24 } },
};

/** Years the SK estimate has parameters for, oldest first. */
export const SK_SZCO_PARAM_YEARS: readonly number[] = Object.keys(SK_TAX_YEARS)
  .map(Number)
  .sort((a, b) => a - b);

function pick<T>(table: Record<number, T>, year: number): T & { year: number; exact: boolean } {
  const known = Object.keys(table)
    .map(Number)
    .sort((a, b) => a - b);
  const exact = year in table;
  const y = exact ? year : year < known[0]! ? known[0]! : known[known.length - 1]!;
  return { ...table[y]!, year: y, exact };
}

export const skTaxParamsFor = (year: number) => pick(SK_TAX_YEARS, year);
export const skSocialRegimeFor = (year: number) => pick(SK_SOCIAL_FROM_JULY, year);

export const SK_FLAT_EXPENSE_SHARE = 0.6;
export const SK_FLAT_EXPENSE_CAP = 20_000;
/** § 13 ods. 2 zákona č. 580/2004 Z. z. and § 138 ods. 2 zákona č. 461/2003 Z. z. */
const INSURANCE_DIVISOR = 1.486;
const SOCIAL_PARTS = [0.044, 0.18, 0.06, 0.0475] as const;

// Through whole cents first so float noise (121.9199999) does not lose a cent.
const floor2 = (n: number) => Math.floor(Math.round(Math.max(0, n) * 1e6) / 1e4) / 100;
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Monthly social poistné: each fund's share rounded down to cents, then summed. */
export function skSocialPremium(base: number): number {
  return round2(SOCIAL_PARTS.reduce((sum, r) => sum + floor2(base * r), 0));
}

/**
 * NČZD na daňovníka for a tax base (§ 11 ods. 2 ZDP). The ŽM multiples are
 * rounded to cents the way Finančná správa publishes them (14 661,11 €).
 */
export function skTaxpayerAllowance(p: SkTaxYearParams, taxBase: number): number {
  const zm = p.subsistenceMinimum;
  if (taxBase <= round2(p.nczdLimit * zm)) return round2(21 * zm);
  return floor2(round2(p.nczdTaper * zm) - taxBase / p.nczdDivisor);
}

/** Income tax on the taxable base (after NČZD). */
export function skIncomeTax(p: SkTaxYearParams, taxable: number, businessIncome: number): number {
  if (businessIncome <= p.reducedRateLimit) return floor2(taxable * 0.15);
  let tax = 0;
  let lower = 0;
  for (const b of p.brackets) {
    const upper = b.upTo == null ? Infinity : round2(b.upTo * p.subsistenceMinimum);
    if (taxable > lower) tax += (Math.min(taxable, upper) - lower) * b.rate;
    lower = upper;
  }
  return floor2(tax);
}

export interface SkSzcoAnnualInput {
  year: number;
  income: number;
  actualExpenses: number;
  /** true = paušálne výdavky 60 %, false = actual expenses (without the poistné). */
  flatRate: boolean;
  /** Social / health poistné paid during the year; deductible, and the health balance is settled against it. */
  paidSocial?: number;
  paidHealth?: number;
  /** Months as SZČO, 1–12 (default 12). Scales the health minimum and the social monthly base. */
  activeMonths?: number;
}

export function computeSkSzcoAnnualSummary(input: SkSzcoAnnualInput) {
  const p = skTaxParamsFor(input.year);
  const months = input.activeMonths != null && Number.isInteger(input.activeMonths) && input.activeMonths >= 1 && input.activeMonths <= 12 ? input.activeMonths : 12;
  const income = Math.max(0, input.income);
  const paidSocial = Math.max(0, input.paidSocial ?? 0);
  const paidHealth = Math.max(0, input.paidHealth ?? 0);

  const flatExpenses = input.flatRate ? Math.min(floor2(income * SK_FLAT_EXPENSE_SHARE), SK_FLAT_EXPENSE_CAP) : null;
  const expenses = flatExpenses ?? Math.max(0, input.actualExpenses);
  // ZD before the poistné: what both insurance bases start from.
  const profit = Math.max(0, income - expenses);
  const taxBase = floor2(Math.max(0, profit - paidSocial - paidHealth));

  const allowance = Math.max(0, skTaxpayerAllowance(p, taxBase));
  const taxable = floor2(Math.max(0, taxBase - allowance));
  const reducedRate = income <= p.reducedRateLimit;
  const incomeTax = skIncomeTax(p, taxable, income);

  // Health, ročné zúčtovanie for the year.
  const healthMin = p.health.minBase * months;
  const healthBase = Math.max(floor2(profit / INSURANCE_DIVISOR), healthMin);
  const health = floor2(healthBase * p.health.rate);
  const nextTax = skTaxParamsFor(input.year + 1);
  const nextMinHealth = floor2(nextTax.health.minBase * nextTax.health.rate);
  const healthAdvance = Math.max(floor2((healthBase / months) * nextTax.health.rate), nextMinHealth);

  // Social insurance from 1 July of the next year, decided by this year's income.
  const regime = skSocialRegimeFor(input.year + 1);
  let socialMode: 'none' | 'micro' | 'normal' = 'normal';
  let socialBase = 0;
  if (income <= (regime.micro?.from ?? regime.threshold)) socialMode = 'none';
  else if (regime.micro && income <= regime.threshold) {
    socialMode = 'micro';
    socialBase = regime.micro.base;
  } else socialBase = Math.min(Math.max(floor2(profit / INSURANCE_DIVISOR / months), regime.minBase), regime.maxBase);
  const socialMonthly = socialMode === 'none' ? 0 : skSocialPremium(socialBase);

  return {
    year: input.year,
    activeMonths: months,
    params: { paramsYear: p.year, exact: p.exact, socialRegimeYear: regime.year, socialExact: regime.exact, subsistenceMinimum: p.subsistenceMinimum },
    income: round2(income),
    actualExpenses: round2(Math.max(0, input.actualExpenses)),
    flatRate: input.flatRate,
    flatExpenses,
    expenses: round2(expenses),
    profit: round2(profit),
    tax: {
      base: taxBase,
      paidInsurance: round2(paidSocial + paidHealth),
      allowance,
      taxable,
      reducedRate,
      total: incomeTax,
    },
    health: {
      base: round2(healthBase),
      rate: p.health.rate,
      total: health,
      paid: input.paidHealth ?? null,
      balance: input.paidHealth == null ? null : round2(health - paidHealth),
      nextAdvance: healthAdvance,
    },
    social: {
      fromJuly: input.year + 1,
      mode: socialMode,
      monthlyBase: round2(socialBase),
      monthly: socialMonthly,
      threshold: regime.threshold,
      paid: input.paidSocial ?? null,
    },
    /** Tax plus the year's health insurance plus the social poistné actually paid in the year. */
    totalBurden: round2(incomeTax + health + paidSocial),
  };
}

export type SkSzcoAnnualSummary = ReturnType<typeof computeSkSzcoAnnualSummary>;
