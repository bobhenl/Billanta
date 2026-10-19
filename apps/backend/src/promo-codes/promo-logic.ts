import { isPaidPlan, planRank, type PaidPlan } from "../billing/plans";
import { addMonths, prepaidUntilAfterPayment } from "../billing/prepaid-period";

/**
 * Promo codes issued by Billanta staff (events, creators, schools). A code
 * gives either extra trial days or free months of a plan, the two things
 * the plan model (`billing/plan-access.ts`) already knows: a trial and a
 * prepaid period. Percent-off would need a Stripe coupon and is left out.
 */
export const PROMO_KINDS = ["event", "creator", "school", "other"] as const;
export type PromoKind = (typeof PROMO_KINDS)[number];

/** The keys of BUSINESS_PRESETS in apps/frontend/lib/business-presets.ts; keep the two in step. */
export const PROMO_PRESETS = ["invoicingOnly", "flatTax", "tradesman", "withAccountant", "eshop"] as const;
export type PromoPreset = (typeof PROMO_PRESETS)[number];

export const PROMO_LOCALES = ["cs", "sk", "en"] as const;

export const PROMO_BENEFITS = ["trial_days", "free_months"] as const;
export type PromoBenefit = (typeof PROMO_BENEFITS)[number];

/** Upper bounds, so a typo in the admin form can't give away ten years. */
export const PROMO_MAX_VALUE: Record<PromoBenefit, number> = { trial_days: 365, free_months: 24 };

export type PromoError =
  | "promo_invalid"
  | "promo_expired"
  | "promo_used_up"
  | "promo_already_applied"
  | "promo_subscription_active"
  | "promo_plan_conflict";

/** Letters, digits and dashes, 3–32 long. Stored and compared in upper case. */
export const PROMO_CODE = /^[A-Z0-9](?:[A-Z0-9-]{1,30}[A-Z0-9])$/;

/** What the visitor typed, as stored: trimmed, upper case, inner spaces dropped. Null when it can't be a code. */
export function normalizePromoCode(raw: string): string | null {
  const code = raw.trim().replace(/\s+/g, "").toUpperCase();
  return PROMO_CODE.test(code) ? code : null;
}

export interface PromoValidity {
  active: boolean;
  /** `YYYY-MM-DD`, first day the code works (inclusive). */
  validFrom: string | null;
  /** `YYYY-MM-DD`, last day the code works (inclusive). */
  validUntil: string | null;
  maxRedemptions: number | null;
  redemptionCount: number;
}

/**
 * Why the code can't be redeemed today, or null. A switched-off code and one
 * whose campaign has not started yet both read as `promo_invalid`, the same
 * as an unknown one, so guessing reveals nothing about codes being prepared.
 */
export function promoRejection(p: PromoValidity, today: string): PromoError | null {
  if (!p.active) return "promo_invalid";
  if (p.validFrom && today < p.validFrom) return "promo_invalid";
  if (p.validUntil && today > p.validUntil) return "promo_expired";
  if (p.maxRedemptions !== null && p.redemptionCount >= p.maxRedemptions) return "promo_used_up";
  return null;
}

export interface PromoGrant {
  benefit: PromoBenefit;
  plan: PaidPlan;
  /** Days for `trial_days`, months for `free_months`. */
  value: number;
}

export interface PromoTenantFields {
  trialPlan: string | null;
  trialStartedAt: Date | null;
  trialEndsAt: Date | null;
  prepaidPlan: string | null;
  prepaidUntil: string | null;
  subscriptionPlan: string | null;
  subscriptionStatus: string;
}

export type PromoPatch =
  | { trialPlan: PaidPlan; trialStartedAt: Date; trialEndsAt: Date; trialRemindedDays: null }
  | { prepaidPlan: PaidPlan; prepaidUntil: string };

const DAY_MS = 86_400_000;
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/**
 * The `tenants` columns that change when the company redeems `grant`.
 *
 * - trial_days: added on top of a running trial (keeping the better of the
 *   two plans), else a fresh trial from now. The "trial ends" reminders
 *   start over for the new end.
 * - free_months: a prepaid period, like months paid with credits. It starts
 *   after a running trial of an equal or better plan, so a "3 months free"
 *   code redeemed at sign-up doesn't melt away under the welcome trial.
 *   Refused next to a card subscription (it would keep billing anyway) and
 *   next to a prepaid period of another plan (the two can't be merged).
 */
export function promoPatch(
  t: PromoTenantFields,
  grant: PromoGrant,
  now: Date,
): { ok: true; patch: PromoPatch } | { ok: false; error: PromoError } {
  const trialActive = isPaidPlan(t.trialPlan) && t.trialEndsAt !== null && t.trialEndsAt > now;

  if (grant.benefit === "trial_days") {
    const base = trialActive ? t.trialEndsAt! : now;
    const plan = trialActive && planRank(t.trialPlan as PaidPlan) > planRank(grant.plan) ? (t.trialPlan as PaidPlan) : grant.plan;
    return {
      ok: true,
      patch: {
        trialPlan: plan,
        trialStartedAt: trialActive && t.trialStartedAt ? t.trialStartedAt : now,
        trialEndsAt: new Date(base.getTime() + grant.value * DAY_MS),
        trialRemindedDays: null,
      },
    };
  }

  const subscriptionLive = isPaidPlan(t.subscriptionPlan) && (t.subscriptionStatus === "active" || t.subscriptionStatus === "past_due");
  if (subscriptionLive) return { ok: false, error: "promo_subscription_active" };
  const today = isoDay(now);
  const prepaidRunning = t.prepaidPlan !== null && t.prepaidUntil !== null && t.prepaidUntil >= today;
  if (prepaidRunning && t.prepaidPlan !== grant.plan) return { ok: false, error: "promo_plan_conflict" };
  if (prepaidRunning) {
    return { ok: true, patch: { prepaidPlan: grant.plan, prepaidUntil: prepaidUntilAfterPayment(t, grant.plan, grant.value, today) } };
  }
  const afterTrial = trialActive && planRank(t.trialPlan as PaidPlan) >= planRank(grant.plan) ? isoDay(t.trialEndsAt!) : today;
  return { ok: true, patch: { prepaidPlan: grant.plan, prepaidUntil: addMonths(afterTrial, grant.value) } };
}
