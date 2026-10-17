/**
 * Referral payouts and what credits buy. 1 credit = 1 Kč (EUR companies see
 * the same credits; plans are priced in CZK for redemption).
 *
 * - friend: the invited company gets a month of Start on sign-up, the inviter
 *   a month of Plus once the invited company starts paying.
 * - accountant: the partner programme for accountants and bookkeeping firms.
 *   Their clients get a month of Plus, the accountant a month of Business
 *   per paying client.
 *
 * The inviter is paid only for a PAYING company, so throwaway sign-ups earn
 * nothing; the welcome bonus only ever lands on the new company itself.
 * `claim_referral` / `reward_referral` (migration 0044) clamp these values.
 *
 * Prices mirror apps/frontend/lib/plans.ts (CZK, monthly and yearly-per-month).
 */
export const REFERRAL_REWARDS = {
  friend: { welcome: 149, reward: 289 },
  accountant: { welcome: 289, reward: 579 },
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
