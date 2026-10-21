/**
 * The company's effective plan as the backend computes it
 * (`planSummary` in apps/backend/src/billing/plan-access.ts).
 */
export type PlanKey = 'free' | 'start' | 'plus' | 'business';
export type PaidPlanKey = Exclude<PlanKey, 'free'>;

export interface PlanSummary {
  plan: PlanKey;
  source: 'free' | 'trial' | 'prepaid' | 'subscription' | 'demo';
  enforced: boolean;
  paidPlan: PlanKey | null;
  trial: { plan: PlanKey; endsAt: string; daysLeft: number; active: boolean } | null;
  prepaidUntil: string | null;
  subscriptionStatus: string;
}

/**
 * The welcome trial every new company gets, no card. Copies of TRIAL_PLAN /
 * DEFAULT_TRIAL_DAYS in apps/backend/src/billing/plans.ts, the one place it
 * is defined; plans.spec.ts there fails if these drift.
 */
export const TRIAL_PLAN: PaidPlanKey = 'plus';
export const DEFAULT_TRIAL_DAYS = 7;
/** Total trial length with a saved card (CARD_TRIAL_DAYS in the backend). */
export const CARD_TRIAL_DAYS = 30;

/** TRIAL_DAYS (server env, shared with the backend); 0 turns the trial off. Same clamp as the SQL bootstrap. */
export function trialDays(raw: string | undefined = process.env.TRIAL_DAYS): number {
  if (raw === undefined || raw.trim() === '') return DEFAULT_TRIAL_DAYS;
  const n = Number(raw);
  return Number.isInteger(n) ? Math.min(Math.max(n, 0), 90) : DEFAULT_TRIAL_DAYS;
}
