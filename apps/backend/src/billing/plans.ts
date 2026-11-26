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

/**
 * The welcome trial a new company gets, no card: Plus, the plan most
 * companies end up on, rather than Business, so the drop to Free afterwards
 * is smaller and the upgrade it asks for is the one people buy. Who gets it
 * is in welcome-trial.ts. These two are the only place the trial is
 * defined: `grant_welcome_trial` (rls-policies.sql) and
 * apps/frontend/lib/plan.ts carry copies that
 * plans.spec.ts keeps in step. TRIAL_DAYS in the env can still shorten or
 * switch it off per deployment.
 */
export const TRIAL_PLAN: PaidPlan = "plus";
export const DEFAULT_TRIAL_DAYS = 7;

/**
 * Total trial length once the owner saves a card (setup only, nothing
 * charged), counted from the trial's start. Needs TRIAL_CARD_EXTENSION=1 and
 * Stripe; see WelcomeTrialService.extendWithCard. The frontend copy is
 * checked by plans.spec.ts too.
 */
export const CARD_TRIAL_DAYS = 30;

/** The card extension is offered only when switched on and Stripe is set up. */
export function cardTrialEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.TRIAL_CARD_EXTENSION === "1" && Boolean(env.STRIPE_SECRET_KEY);
}

/** TRIAL_DAYS from env (0 turns the trial off), clamped like grant_welcome_trial does. */
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
  stripe_sync: "start",
  api_keys: "start",
  card_payments: "plus",
  /** Pohoda and Money S3 XML. */
  accounting_export: "start",
  /** Downloads of the income-tax basis and the annual filings (the on-screen figures stay open). */
  income_tax_export: "start",
  /** CZ and SK VAT return, control statement and EC sales list files. */
  vat_filings: "plus",
  client_portal: "start",
  auto_reminders: "start",
  webhooks: "start",
  confidential_mode: "plus",
} as const satisfies Record<string, PaidPlan>;
export type PlanFeature = keyof typeof FEATURE_MIN_PLAN;

/**
 * What a plan below a feature's minimum may still use of it, so people see
 * the value before they pay: `per: "month"` resets every calendar month,
 * `per: "ever"` is once for the company's whole life.
 */
export const FEATURE_TASTE: Partial<Record<PlanFeature, { uses: number; per: "month" | "ever" }>> = {
  accounting_export: { uses: 1, per: "month" },
  vat_filings: { uses: 1, per: "ever" },
};

/**
 * People in the team per plan, the owner included (the pricing page's
 * "3 uživatelé + účetní"). Accountants have their own small allowance so a
 * company can bring its accounting firm, but can't pass the whole team off
 * as accountants. Members over the limit after a downgrade stay; only new
 * invitations are refused.
 */
export const PLAN_SEATS: Record<PlanKey, number> = { free: 1, start: 1, plus: 3, business: 10 };
export const ACCOUNTANT_SEATS = 2;

/** People the "Po zdanění" report splits income between. */
export const PLAN_PARTNERS: Record<PlanKey, number> = { free: 1, start: 2, plus: 3, business: 10 };

/** The cheapest plan that allows `n` of something, or null when none does. */
export function planFor(limits: Record<PlanKey, number>, n: number): PaidPlan | null {
  return PAID_PLANS.find((p) => limits[p] >= n) ?? null;
}

/** Free keeps two recurring templates; more need a paid plan. */
export const FREE_RECURRING_TEMPLATES = 2;

/**
 * Monthly allowances per plan; null means no limit. Only companies with
 * `plan_enforced` are held to them (plan-access.ts). The pricing page reads
 * a copy in apps/frontend/lib/plans.ts (PLAN_LIMITS); plans.spec.ts keeps
 * the two equal.
 */
export const PLAN_LIMITS = {
  /** Documents issued (drafts don't count). */
  documents: { free: 10, start: null, plus: null, business: null },
  /** One credit = one AI suggestion or one read receipt on Billanta's key. */
  ai_credits: { free: 5, start: 30, plus: 150, business: 500 },
  /** Public-API requests made with an API key. */
  api_requests: { free: 0, start: 1000, plus: 10000, business: 50000 },
} as const satisfies Record<string, Record<PlanKey, number | null>>;
export type LimitedResource = keyof typeof PLAN_LIMITS;

/** The cheapest plan whose limit for `resource` is above `current`'s (null when none is). */
export function upgradeFor(resource: LimitedResource, current: PlanKey): PaidPlan | null {
  const now = PLAN_LIMITS[resource][current];
  if (now === null) return null;
  for (const plan of PAID_PLANS) {
    if (planRank(plan) <= planRank(current)) continue;
    const next = PLAN_LIMITS[resource][plan];
    if (next === null || next > now) return plan;
  }
  return null;
}
