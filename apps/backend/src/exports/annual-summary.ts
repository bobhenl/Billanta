/**
 * Rough annual figures for a Czech sole trader (OSVČ, §7 ZDP): income tax
 * (DPFO), social (ČSSZ) and health insurance, and next year's advances.
 * It is an estimate for planning: it ignores other income, deductions other
 * than the basic taxpayer credit, children, losses and part-year activity.
 *
 * Yearly parameters: průměrná mzda (nařízení vlády / MPSV), the share of it
 * used as the minimum social base (consolidation package: 30 % → 35 % → 40 %),
 * and the tax brackets derived from it.
 */
import { advanceTotalFor, type TaxAdvancePeriod } from "@faktur/cz-compliance";

export interface YearParams {
  /** "Průměrná mzda" used for the year (CZK / month). */
  averageWage: number;
  /** Minimum monthly social base as a share of the average wage (main activity). */
  minSocialShare: number;
  /** Basic taxpayer credit (sleva na poplatníka, CZK / year). */
  taxpayerCredit: number;
}

export const YEAR_PARAMS: Record<number, YearParams> = {
  2024: { averageWage: 43_967, minSocialShare: 0.3, taxpayerCredit: 30_840 },
  2025: { averageWage: 46_557, minSocialShare: 0.35, taxpayerCredit: 30_840 },
  2026: { averageWage: 48_967, minSocialShare: 0.4, taxpayerCredit: 30_840 },
};

export function paramsFor(year: number): YearParams & { year: number; exact: boolean } {
  const known = Object.keys(YEAR_PARAMS).map(Number).sort((a, b) => a - b);
  const exact = year in YEAR_PARAMS;
  const pick = exact ? year : year < known[0]! ? known[0]! : known[known.length - 1]!;
  return { ...YEAR_PARAMS[pick]!, year: pick, exact };
}

/** Paušální výdaje by activity: share of income and the yearly cap. */
export const FLAT_RATES = {
  80: 1_600_000, // crafts, agriculture
  60: 1_200_000, // most trades (živnost volná / vázaná)
  40: 800_000, // liberal professions, other §7 income
  30: 600_000, // renting business assets
} as const;
export type FlatRate = keyof typeof FLAT_RATES;

const SOCIAL_RATE = 0.292;
const HEALTH_RATE = 0.135;
const SOCIAL_BASE_SHARE = 0.55;
const HEALTH_BASE_SHARE = 0.5;
const TAX_LOW = 0.15;
const TAX_HIGH = 0.23;

// Rounded to haléře first so float noise (220 000.000…03) does not add a crown.
const roundUp = (n: number) => Math.ceil(Math.round(Math.max(0, n) * 100) / 100);
/** Tax base is rounded down to whole hundreds (§16 ZDP). */
const floorHundreds = (n: number) => Math.floor(Math.max(0, n) / 100) * 100;

export interface AnnualSummaryInput {
  year: number;
  income: number;
  actualExpenses: number;
  /** null = use actual expenses. */
  flatRate: FlatRate | null;
  /** Social / health advances already paid during the year (optional). */
  paidSocial?: number;
  paidHealth?: number;
}

export function computeAnnualSummary(input: AnnualSummaryInput) {
  const p = paramsFor(input.year);
  const income = Math.max(0, input.income);
  const flatExpenses = input.flatRate ? Math.min(income * (input.flatRate / 100), FLAT_RATES[input.flatRate]) : null;
  const expenses = flatExpenses ?? Math.max(0, input.actualExpenses);
  const profit = Math.max(0, income - expenses);

  // Income tax: 15 %, 23 % above 36× the average wage; minus the taxpayer credit.
  const taxBase = floorHundreds(profit);
  const highThreshold = 36 * p.averageWage;
  const taxBeforeCredit = Math.min(taxBase, highThreshold) * TAX_LOW + Math.max(0, taxBase - highThreshold) * TAX_HIGH;
  const incomeTax = roundUp(taxBeforeCredit - p.taxpayerCredit);

  // Social insurance: 55 % of profit, at least the yearly minimum, at most 48× the average wage.
  const minSocialMonthly = roundUp(p.averageWage * p.minSocialShare);
  const socialBase = Math.min(Math.max(profit * SOCIAL_BASE_SHARE, minSocialMonthly * 12), 48 * p.averageWage);
  const social = roundUp(socialBase * SOCIAL_RATE);

  // Health insurance: 50 % of profit, at least 50 % of the average wage per month.
  const minHealthMonthly = roundUp(p.averageWage * 0.5);
  const healthBase = Math.max(profit * HEALTH_BASE_SHARE, minHealthMonthly * 12);
  const health = roundUp(healthBase * HEALTH_RATE);

  // Next year's monthly advances (from this year's base, never under next year's minimum).
  const next = paramsFor(input.year + 1);
  const nextMinSocial = roundUp(roundUp(next.averageWage * next.minSocialShare) * SOCIAL_RATE);
  const nextMinHealth = roundUp(roundUp(next.averageWage * 0.5) * HEALTH_RATE);
  const socialAdvance = Math.max(roundUp((socialBase / 12) * SOCIAL_RATE), nextMinSocial);
  const healthAdvance = Math.max(roundUp((healthBase / 12) * HEALTH_RATE), nextMinHealth);

  return {
    year: input.year,
    params: { averageWage: p.averageWage, paramsYear: p.year, exact: p.exact },
    income: round2(income),
    actualExpenses: round2(Math.max(0, input.actualExpenses)),
    flatRate: input.flatRate,
    flatExpenses: flatExpenses == null ? null : round2(flatExpenses),
    expenses: round2(expenses),
    profit: round2(profit),
    tax: { base: taxBase, beforeCredit: roundUp(taxBeforeCredit), credit: p.taxpayerCredit, total: incomeTax },
    social: {
      base: roundUp(socialBase),
      total: social,
      paid: input.paidSocial ?? null,
      balance: input.paidSocial == null ? null : social - input.paidSocial,
      nextAdvance: socialAdvance,
    },
    health: {
      base: roundUp(healthBase),
      total: health,
      paid: input.paidHealth ?? null,
      balance: input.paidHealth == null ? null : health - input.paidHealth,
      nextAdvance: healthAdvance,
    },
    totalBurden: incomeTax + social + health,
  };
}

export type AnnualSummary = ReturnType<typeof computeAnnualSummary>;

/**
 * Paid social / health advances for the summary: a typed amount wins,
 * otherwise the advances from Settings for the 12 months of the year (each
 * month with the amount that applied then). `source` says which one was used.
 */
export function paidAdvances(
  list: readonly TaxAdvancePeriod[],
  year: number,
  typed: { paidSocial?: number; paidHealth?: number },
): { paidSocial?: number; paidHealth?: number; source: Record<"social" | "health", "input" | "settings" | null> } {
  const pick = (kind: "social" | "health", value: number | undefined) => {
    if (value != null) return { value, source: "input" as const };
    const fromSettings = advanceTotalFor(list, kind, year);
    return fromSettings == null ? { value: undefined, source: null } : { value: fromSettings, source: "settings" as const };
  };
  const social = pick("social", typed.paidSocial);
  const health = pick("health", typed.paidHealth);
  return { paidSocial: social.value, paidHealth: health.value, source: { social: social.source, health: health.source } };
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}
