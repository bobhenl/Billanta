/**
 * The company's effective plan as the backend computes it
 * (`planSummary` in apps/backend/src/billing/plan-access.ts).
 */
export type PlanKey = 'free' | 'start' | 'plus' | 'business';
export type PaidPlanKey = Exclude<PlanKey, 'free'>;

export interface PlanSummary {
  plan: PlanKey;
  source: 'free' | 'trial' | 'prepaid' | 'subscription';
  enforced: boolean;
  paidPlan: PlanKey | null;
  trial: { plan: PlanKey; endsAt: string; daysLeft: number; active: boolean } | null;
  prepaidUntil: string | null;
  subscriptionStatus: string;
}

export const DEFAULT_TRIAL_DAYS = 14;

/** TRIAL_DAYS (server env, shared with the backend); 0 turns the trial off. Same clamp as the SQL bootstrap. */
export function trialDays(raw: string | undefined = process.env.TRIAL_DAYS): number {
  if (raw === undefined || raw.trim() === '') return DEFAULT_TRIAL_DAYS;
  const n = Number(raw);
  return Number.isInteger(n) ? Math.min(Math.max(n, 0), 90) : DEFAULT_TRIAL_DAYS;
}
