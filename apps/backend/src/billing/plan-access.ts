import { FEATURE_MIN_PLAN, isPaidPlan, planRank, type PlanFeature, type PlanKey } from "./plans";

/** The `tenants` columns the plan is worked out from. */
export interface TenantPlanFields {
  planEnforced: boolean;
  trialPlan: string | null;
  trialStartedAt: Date | null;
  trialEndsAt: Date | null;
  prepaidPlan: string | null;
  /** `YYYY-MM-DD`, the last day still paid. */
  prepaidUntil: string | null;
  subscriptionPlan: string | null;
  subscriptionStatus: string;
}

export type PlanSource = "subscription" | "prepaid" | "trial" | "free";

export interface PlanSummary {
  plan: PlanKey;
  source: PlanSource;
  /** False for companies from before plan limits: nothing is restricted for them. */
  enforced: boolean;
  /** Best plan the company pays for (subscription or prepaid), regardless of a trial on top. */
  paidPlan: PlanKey | null;
  trial: { plan: PlanKey; endsAt: string; daysLeft: number; active: boolean } | null;
  prepaidUntil: string | null;
  subscriptionStatus: string;
}

const DAY_MS = 86_400_000;

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Whole days until `endsAt`, rounded up: 1 means "ends within a day", 0 means over. */
export function daysLeft(endsAt: Date, now: Date): number {
  const ms = endsAt.getTime() - now.getTime();
  return ms <= 0 ? 0 : Math.ceil(ms / DAY_MS);
}

/**
 * The plan a company has right now: the best of a live Stripe subscription,
 * a prepaid period (credits or a paid proforma) and a running trial, else
 * free. Worked out on every read, so a trial ends on time without any job
 * having to flip a flag, and nothing about the company's data changes.
 */
export function planSummary(t: TenantPlanFields, now: Date = new Date()): PlanSummary {
  const candidates: { plan: PlanKey; source: PlanSource }[] = [];
  // past_due keeps the plan while Stripe retries the payment; canceled doesn't.
  if (isPaidPlan(t.subscriptionPlan) && (t.subscriptionStatus === "active" || t.subscriptionStatus === "past_due")) {
    candidates.push({ plan: t.subscriptionPlan, source: "subscription" });
  }
  if (isPaidPlan(t.prepaidPlan) && t.prepaidUntil && t.prepaidUntil >= isoDay(now)) {
    candidates.push({ plan: t.prepaidPlan, source: "prepaid" });
  }
  let trial: PlanSummary["trial"] = null;
  if (isPaidPlan(t.trialPlan) && t.trialEndsAt) {
    const left = daysLeft(t.trialEndsAt, now);
    trial = { plan: t.trialPlan, endsAt: t.trialEndsAt.toISOString(), daysLeft: left, active: left > 0 };
    if (trial.active) candidates.push({ plan: t.trialPlan, source: "trial" });
  }
  const paid = candidates.filter((c) => c.source !== "trial").sort((a, b) => planRank(b.plan) - planRank(a.plan))[0];
  const best = candidates.reduce<{ plan: PlanKey; source: PlanSource }>(
    (a, c) => (planRank(c.plan) > planRank(a.plan) ? c : a),
    { plan: "free", source: "free" },
  );
  return {
    ...best,
    enforced: t.planEnforced,
    paidPlan: paid?.plan ?? null,
    trial,
    prepaidUntil: t.prepaidUntil,
    subscriptionStatus: t.subscriptionStatus,
  };
}

/** Whether the plan lets the company create or switch on more of `feature`. */
export function planAllows(summary: Pick<PlanSummary, "plan" | "enforced">, feature: PlanFeature): boolean {
  if (!summary.enforced) return true;
  return planRank(summary.plan) >= planRank(FEATURE_MIN_PLAN[feature]);
}

/**
 * Which "trial ends" message is due: 3 or 1 days before the end, 0 once it
 * ended. `remindedDays` is the stage already sent. Nothing for a company that
 * pays (it no longer depends on the trial) or a trial long over (a company
 * created before the job existed shouldn't get a stale "trial ended").
 */
export function trialReminderDue(
  summary: PlanSummary,
  remindedDays: number | null,
  now: Date = new Date(),
): 3 | 1 | 0 | null {
  const trial = summary.trial;
  if (!trial || summary.paidPlan) return null;
  const stage: 3 | 1 | 0 | null = trial.daysLeft === 0 ? 0 : trial.daysLeft <= 1 ? 1 : trial.daysLeft <= 3 ? 3 : null;
  if (stage === null) return null;
  if (remindedDays !== null && remindedDays <= stage) return null;
  if (stage === 0 && now.getTime() - new Date(trial.endsAt).getTime() > 3 * DAY_MS) return null;
  return stage;
}
