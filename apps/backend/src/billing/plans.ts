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

/** TRIAL_DAYS from env (0 turns the trial off), clamped like the SQL bootstrap does. */
export function trialDays(raw: string | undefined = process.env.TRIAL_DAYS): number {
  if (raw === undefined || raw.trim() === "") return DEFAULT_TRIAL_DAYS;
  const n = Number(raw);
  return Number.isInteger(n) ? Math.min(Math.max(n, 0), 90) : DEFAULT_TRIAL_DAYS;
}

/** Prices in minor units (haléře / cents) so nothing is rounded twice. */
export const PLAN_PRICES_MINOR: Record<PaidPlan, Record<PlanCurrency, { monthly: number; yearly: number }>> = {
  start: { CZK: { monthly: 14900, yearly: 11900 }, EUR: { monthly: 599, yearly: 499 } },
  plus: { CZK: { monthly: 28900, yearly: 23900 }, EUR: { monthly: 1199, yearly: 999 } },
  business: { CZK: { monthly: 57900, yearly: 47900 }, EUR: { monthly: 2399, yearly: 1999 } },
};

/**
 * The prices above are what a card subscription costs (Stripe, renews by
 * itself). A period paid by bank transfer costs this much more, because each
 * renewal is a proforma, a reminder and a payment someone pairs by hand.
 * Change it here only; apps/frontend/lib/plans.ts mirrors it (a spec checks).
 */
export const BANK_TRANSFER_SURCHARGE_PERCENT = 10;

export type PaymentMethod = "card" | "transfer";

/**
 * A per-month card price with the transfer surcharge, rounded up to a whole
 * koruna (CZK) or cent (EUR), so the price list shows 164 Kč, not 163,90 Kč.
 */
export function transferPriceMinor(cardMinor: number, currency: PlanCurrency): number {
  const step = currency === "CZK" ? 100 : 1;
  return Math.ceil((cardMinor * (100 + BANK_TRANSFER_SURCHARGE_PERCENT)) / (100 * step)) * step;
}

/** Per-month prices for a period paid by bank transfer, same shape as PLAN_PRICES_MINOR. */
export function transferPricesMinor(): Record<PaidPlan, Record<PlanCurrency, { monthly: number; yearly: number }>> {
  const out = {} as Record<PaidPlan, Record<PlanCurrency, { monthly: number; yearly: number }>>;
  for (const plan of PAID_PLANS) {
    const row = {} as Record<PlanCurrency, { monthly: number; yearly: number }>;
    for (const currency of ["CZK", "EUR"] as const) {
      const p = PLAN_PRICES_MINOR[plan][currency];
      row[currency] = { monthly: transferPriceMinor(p.monthly, currency), yearly: transferPriceMinor(p.yearly, currency) };
    }
    out[plan] = row;
  }
  return out;
}

/** What one billing period costs: a month, or twelve months at the yearly rate. */
export function periodPriceMinor(plan: PaidPlan, currency: PlanCurrency, interval: BillingInterval, method: PaymentMethod = "card"): number {
  const card = PLAN_PRICES_MINOR[plan][currency];
  const perMonth = interval === "year" ? card.yearly : card.monthly;
  const price = method === "transfer" ? transferPriceMinor(perMonth, currency) : perMonth;
  return interval === "year" ? price * 12 : price;
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
