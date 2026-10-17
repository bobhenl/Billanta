/**
 * The plan ladder as the backend needs it: order, prices for checkout and
 * proformas, and which feature needs which plan. Prices mirror
 * apps/frontend/lib/plans.ts (per month without VAT; `yearly` is the
 * per-month price when the whole year is paid up front).
 */
export const PLAN_KEYS = ["free", "start", "plus", "business"] as const;
export type PlanKey = (typeof PLAN_KEYS)[number];
export type PaidPlan = Exclude<PlanKey, "free">;
export const PAID_PLANS: readonly PaidPlan[] = ["start", "plus", "business"];

export type PlanCurrency = "CZK" | "EUR";
export type BillingInterval = "month" | "year";

/** The plan a new company tries for free. */
export const TRIAL_PLAN: PaidPlan = "business";
export const DEFAULT_TRIAL_DAYS = 14;

/** Prices in minor units (haléře / cents) so nothing is rounded twice. */
export const PLAN_PRICES_MINOR: Record<PaidPlan, Record<PlanCurrency, { monthly: number; yearly: number }>> = {
  start: { CZK: { monthly: 14900, yearly: 11900 }, EUR: { monthly: 599, yearly: 499 } },
  plus: { CZK: { monthly: 28900, yearly: 23900 }, EUR: { monthly: 1199, yearly: 999 } },
  business: { CZK: { monthly: 57900, yearly: 47900 }, EUR: { monthly: 2399, yearly: 1999 } },
};

/** What one billing period costs: a month, or twelve months at the yearly rate. */
export function periodPriceMinor(plan: PaidPlan, currency: PlanCurrency, interval: BillingInterval): number {
  const p = PLAN_PRICES_MINOR[plan][currency];
  return interval === "year" ? p.yearly * 12 : p.monthly;
}

export function isPaidPlan(value: unknown): value is PaidPlan {
  return typeof value === "string" && (PAID_PLANS as readonly string[]).includes(value);
}

export function planRank(plan: PlanKey): number {
  return PLAN_KEYS.indexOf(plan);
}

/**
 * Features that stop being writable below their plan (the pricing page's
 * comparison table). Existing data stays readable and deletable; only
 * creating or switching on more is refused.
 */
export const FEATURE_MIN_PLAN = {
  bank_sync: "start",
  paypal_sync: "start",
  api_keys: "start",
  card_payments: "plus",
} as const satisfies Record<string, PaidPlan>;
export type PlanFeature = keyof typeof FEATURE_MIN_PLAN;

/** Free keeps two recurring templates; more need a paid plan. */
export const FREE_RECURRING_TEMPLATES = 2;
