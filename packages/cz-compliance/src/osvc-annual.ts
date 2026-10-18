/**
 * Rough annual figures for a Czech sole trader (OSVČ, §7 ZDP): income tax
 * (DPFO), social (ČSSZ) and health insurance, and next year's advances.
 * It is an estimate for planning: it ignores other income, deductions other
 * than the basic taxpayer credit, children and losses. A part year
 * (`activeMonths`) scales only what the law scales by month: the minimum
 * social and health bases (§ 5b odst. 1 zákona č. 589/1992 Sb., § 3a odst. 2
 * zákona č. 592/1992 Sb.). The flat-rate cap (§ 7 odst. 7 ZDP) and the
 * taxpayer credit (§ 35ba odst. 1 a) ZDP) stay yearly amounts.
 *
 * Shared by the backend (Exports, "Roční odhad daně a pojištění" from the
 * company's own invoices) and the public calculator on the marketing site
 * (numbers typed in by the visitor), so both always use the same constants.
 *
 * Yearly parameters come from cz-tax-years.ts (průměrná mzda, the minimum
 * base shares, the 23 % threshold), with a source next to each number.
 */
import { CZ_TAX_YEARS } from './cz-tax-years.js';

export interface OsvcYearParams {
  /** "Průměrná mzda" used for the year (CZK / month). */
  averageWage: number;
  /** Minimum monthly social base as a share of the average wage (main activity), from January. */
  minSocialShare: number;
  /**
   * A mid-year change of that share: from `fromMonth` (1–12) on, `share`
   * applies. The 2026 amendment of zákon č. 589/1992 Sb. (§ 5b) took it back
   * from 40 % to 35 % from July 2026 (minimum social advance 5 005 Kč).
   */
  minSocialShareFrom?: { fromMonth: number; share: number };
  /**
   * Share the yearly minimum base is settled at. The 2026 amendment applies
   * 35 % to the whole year, so the yearly minimum is 12 × 17 139 Kč even
   * though 5 720 Kč was due until June.
   */
  annualMinSocialShare: number;
  /** Basic taxpayer credit (sleva na poplatníka, CZK / year). */
  taxpayerCredit: number;
  /** Share of profit that is the social base (50 % in 2023, 55 % since 2024). */
  socialBaseShare: number;
  /** 23 % above this multiple of the average wage (48× in 2023, 36× since 2024). */
  taxHighMultiple: number;
  /** Maximum yearly social base as a multiple of the average wage. */
  socialMaxMultiple: number;
}

export const OSVC_YEAR_PARAMS: Record<number, OsvcYearParams> = Object.fromEntries(
  Object.entries(CZ_TAX_YEARS).map(([year, y]) => [
    Number(year),
    {
      averageWage: y.averageWage,
      minSocialShare: y.social.mainShare,
      ...(y.social.mainShareFrom ? { minSocialShareFrom: y.social.mainShareFrom } : {}),
      annualMinSocialShare: y.social.annualMainShare,
      taxpayerCredit: y.taxpayerCredit,
      socialBaseShare: y.socialBaseShare,
      taxHighMultiple: y.taxHighMultiple,
      socialMaxMultiple: y.socialMaxMultiple,
    } satisfies OsvcYearParams,
  ]),
);

export function osvcParamsFor(year: number): OsvcYearParams & { year: number; exact: boolean } {
  const known = Object.keys(OSVC_YEAR_PARAMS).map(Number).sort((a, b) => a - b);
  const exact = year in OSVC_YEAR_PARAMS;
  const pick = exact ? year : year < known[0]! ? known[0]! : known[known.length - 1]!;
  return { ...OSVC_YEAR_PARAMS[pick]!, year: pick, exact };
}

/** Minimum social base share in force in `month` (1–12) of the parameters' year. */
export function minSocialShareIn(p: OsvcYearParams, month: number): number {
  return p.minSocialShareFrom && month >= p.minSocialShareFrom.fromMonth ? p.minSocialShareFrom.share : p.minSocialShare;
}

/**
 * Minimum monthly social advance (main activity) for `month` (1–12) of
 * `year`: 29.2 % of the minimum base, both rounded up to whole crowns. It
 * must match the statutory table in tax-minimums.ts (a test pins that).
 */
export function osvcMinSocialAdvance(year: number, month: number): number {
  const p = osvcParamsFor(year);
  return roundUp(roundUp(p.averageWage * minSocialShareIn(p, month)) * SOCIAL_RATE);
}

/** Paušální výdaje by activity: share of income and the yearly cap. */
export const OSVC_FLAT_EXPENSE_CAPS = {
  80: 1_600_000, // crafts, agriculture
  60: 1_200_000, // most trades (živnost volná / vázaná)
  40: 800_000, // liberal professions, other §7 income
  30: 600_000, // renting business assets
} as const;
export type OsvcFlatRate = keyof typeof OSVC_FLAT_EXPENSE_CAPS;

const SOCIAL_RATE = 0.292;
const HEALTH_RATE = 0.135;
const HEALTH_BASE_SHARE = 0.5;
const TAX_LOW = 0.15;
const TAX_HIGH = 0.23;

// Rounded to haléře first so float noise (220 000.000…03) does not add a crown.
const roundUp = (n: number) => Math.ceil(Math.round(Math.max(0, n) * 100) / 100);
/** Tax base is rounded down to whole hundreds (§16 ZDP). */
const floorHundreds = (n: number) => Math.floor(Math.max(0, n) / 100) * 100;

export interface OsvcAnnualInput {
  year: number;
  income: number;
  actualExpenses: number;
  /** null = use actual expenses. */
  flatRate: OsvcFlatRate | null;
  /** Social / health advances already paid during the year (optional). */
  paidSocial?: number;
  paidHealth?: number;
  /** Months with the activity, 1–12 (default 12), e.g. 6 for a start in July. */
  activeMonths?: number;
}

export function computeOsvcAnnualSummary(input: OsvcAnnualInput) {
  const p = osvcParamsFor(input.year);
  const months = clampMonths(input.activeMonths);
  const income = Math.max(0, input.income);
  const flatExpenses = input.flatRate ? Math.min(income * (input.flatRate / 100), OSVC_FLAT_EXPENSE_CAPS[input.flatRate]) : null;
  const expenses = flatExpenses ?? Math.max(0, input.actualExpenses);
  const profit = Math.max(0, income - expenses);

  // Income tax: 15 %, 23 % above 36× (2023: 48×) the average wage; minus the taxpayer credit.
  const taxBase = floorHundreds(profit);
  const highThreshold = p.taxHighMultiple * p.averageWage;
  const taxBeforeCredit = Math.min(taxBase, highThreshold) * TAX_LOW + Math.max(0, taxBase - highThreshold) * TAX_HIGH;
  const incomeTax = roundUp(taxBeforeCredit - p.taxpayerCredit);

  // Social insurance: 55 % of profit, at least the yearly minimum (one monthly
  // minimum base per month of activity, at the share the year is settled at),
  // at most 48× the average wage (a yearly cap, not scaled by months).
  const minSocialYearly = months * roundUp(p.averageWage * p.annualMinSocialShare);
  const socialBase = Math.min(Math.max(profit * p.socialBaseShare, minSocialYearly), p.socialMaxMultiple * p.averageWage);
  const social = roundUp(socialBase * SOCIAL_RATE);

  // Health insurance: 50 % of profit, at least 50 % of the average wage per month of activity.
  const minHealthMonthly = roundUp(p.averageWage * 0.5);
  const healthBase = Math.max(profit * HEALTH_BASE_SHARE, minHealthMonthly * months);
  const health = roundUp(healthBase * HEALTH_RATE);

  // Next year's monthly advances: this year's base per month of activity
  // (přehled ČSSZ ř. 35, přehled ZP), never under next year's minimum.
  const next = osvcParamsFor(input.year + 1);
  // Without parameters for next year, carry this year's December share forward.
  const nextShare = next.exact ? minSocialShareIn(next, 1) : minSocialShareIn(next, 12);
  const nextMinSocial = roundUp(roundUp(next.averageWage * nextShare) * SOCIAL_RATE);
  const nextMinHealth = roundUp(roundUp(next.averageWage * 0.5) * HEALTH_RATE);
  // Someone at the minimum base pays next year's minimum.
  const atSocialMinimum = profit * p.socialBaseShare <= minSocialYearly;
  const socialAdvance = atSocialMinimum ? nextMinSocial : Math.max(roundUp((socialBase / months) * SOCIAL_RATE), nextMinSocial);
  const healthAdvance = Math.max(roundUp((healthBase / months) * HEALTH_RATE), nextMinHealth);

  return {
    year: input.year,
    activeMonths: months,
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

export type OsvcAnnualSummary = ReturnType<typeof computeOsvcAnnualSummary>;

/** Years with published parameters, oldest first (for year pickers). */
export const OSVC_PARAM_YEARS: readonly number[] = Object.keys(OSVC_YEAR_PARAMS)
  .map(Number)
  .sort((a, b) => a - b);

/** 1–12; anything else (missing, 0, 13, NaN) is a full year. */
export function clampMonths(n: number | undefined): number {
  return n != null && Number.isInteger(n) && n >= 1 && n <= 12 ? n : 12;
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}
