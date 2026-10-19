import { PLAN_PRICES_MINOR, type PlanCurrency } from "../billing/plans";

/**
 * Referral payouts and what credits buy. 1 credit = 1 Kč (EUR companies see
 * the same credits; plans are priced in CZK for redemption).
 *
 * - friend: the invited company gets a month of Start on sign-up; the
 *   inviter gets the invited company's first payment, up to a month of Plus.
 * - accountant: the partner programme for accountants and bookkeeping firms,
 *   approved by Billanta staff (accountant_partner_requests, migration 0079).
 *   Same amounts as friend (see below).
 *
 * `welcome` lands on the new company at once. `reward` is a CAP: the inviter
 * gets what the invited company actually paid first, never more, and only
 * after the refund window (see `rewardReleaseAfter`), so a sign-up that pays
 * and asks for its money back earns nothing. `claim_referral` /
 * `record_referral_payment` (migrations 0044, 0079) clamp these values.
 *
 * Prices mirror apps/frontend/lib/plans.ts (CZK, monthly and yearly-per-month).
 *
 * The accountant tier pays the same as friend on purpose (owner decision):
 * it marks a vetted accountant, it is not a bigger payout. The two keys stay
 * so the SQL and the UI can still tell the tiers apart.
 */
export const REFERRAL_REWARDS = {
  friend: { welcome: 149, reward: 289 },
  accountant: { welcome: 149, reward: 289 },
} as const;

export type ReferralProgram = keyof typeof REFERRAL_REWARDS;

export const CREDIT_PLANS = {
  start: { monthly: 149, yearly: 119 },
  plus: { monthly: 289, yearly: 239 },
  business: { monthly: 579, yearly: 479 },
} as const;

export type CreditPlan = keyof typeof CREDIT_PLANS;

/** Credits for `months` of `plan`: 12 months are charged at the yearly rate. */
export function planCost(plan: CreditPlan, months: 1 | 12): number {
  const price = CREDIT_PLANS[plan];
  return months === 12 ? price.yearly * 12 : price.monthly;
}

/** Days a referral can still be claimed after the invited company was created. */
export const CLAIM_WINDOW_DAYS = 30;

/**
 * Days after the first payment of a plan paid for more than a month (annual,
 * or a prepaid year by bank transfer) before the inviter is paid. A monthly
 * plan has no timer: it waits for its second payment instead.
 */
export const REWARD_HOLD_DAYS = 30;

/**
 * Whole koruny of a payment, without VAT. A EUR payment is converted at the
 * price list's own rate (Plus monthly, CZK over EUR), so the same plan earns
 * the same reward in either currency.
 */
export function paymentCzk(amountMinor: number, currency: PlanCurrency): number {
  if (!Number.isFinite(amountMinor) || amountMinor <= 0) return 0;
  if (currency === "CZK") return Math.floor(amountMinor / 100);
  const plus = PLAN_PRICES_MINOR.plus;
  return Math.floor((amountMinor * plus.CZK.monthly) / plus.EUR.monthly / 100);
}

/** The inviter's reward for a first payment of `firstPaymentCzk`: the payment itself, capped per programme. */
export function referralRewardCredits(program: ReferralProgram, firstPaymentCzk: number): number {
  if (!Number.isFinite(firstPaymentCzk) || firstPaymentCzk <= 0) return 0;
  return Math.min(Math.floor(firstPaymentCzk), REFERRAL_REWARDS[program].reward);
}

/**
 * When a reward held back since `paidAt` may be paid by the daily job:
 * `REWARD_HOLD_DAYS` later for a period longer than a month, never (null)
 * for a monthly one, which is released by its second payment instead.
 */
export function rewardReleaseAfter(longPeriod: boolean, paidAt: Date): Date | null {
  return longPeriod ? new Date(paidAt.getTime() + REWARD_HOLD_DAYS * 24 * 60 * 60 * 1000) : null;
}

/** One real payment by an invited company, as the billing code sees it. */
export interface ReferralPayment {
  amountMinor: number;
  currency: PlanCurrency;
  /** Paid for more than a month at once (annual subscription, a 12-month proforma). */
  longPeriod: boolean;
}

/**
 * Arguments of `record_referral_payment`: the reward per programme (the
 * function picks the referral's own) and the release time. Null when the
 * payment is zero, e.g. a trial or a 100 % coupon invoice.
 */
export function referralPaymentArgs(payment: ReferralPayment, paidAt: Date) {
  const czk = paymentCzk(payment.amountMinor, payment.currency);
  if (czk <= 0) return null;
  return {
    friend: referralRewardCredits("friend", czk),
    accountant: referralRewardCredits("accountant", czk),
    releaseAfter: rewardReleaseAfter(payment.longPeriod, paidAt),
  };
}
