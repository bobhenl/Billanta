import { FEATURE_MIN_PLAN, type PlanFeature, type PlanKey } from './plans';
import type { PaidPlanKey, PlanSummary } from './plan';

/** One monthly counter; `limit` null = the plan doesn't cap it (or the company predates limits). */
export interface UsageMeter {
  used: number;
  limit: number | null;
  remaining: number | null;
}

export interface FeatureUsage {
  /** taste = not on this plan, but a free try is left. */
  access: 'plan' | 'taste' | 'locked';
  plan: PaidPlanKey;
  tasteLeft: number | null;
}

/** `GET /api/v1/tenants/me/usage` (`usageOverview` in apps/backend/src/billing/plan-limits.ts). */
export interface UsageOverview {
  period: string;
  plan: PlanKey;
  enforced: boolean;
  documents: UsageMeter;
  aiCredits: UsageMeter;
  apiRequests: UsageMeter;
  features: Partial<Record<PlanFeature, FeatureUsage>>;
  partnersLimit: number | null;
}

/** The plan a locked feature needs, or null when this company may use it (included or a free try left). */
export function lockOf(usage: UsageOverview | null | undefined, feature: PlanFeature): PaidPlanKey | null {
  const f = usage?.features[feature];
  return f?.access === 'locked' ? f.plan : null;
}

const RANK: Record<PlanKey, number> = { free: 0, start: 1, plus: 2, business: 3 };

/** Same as lockOf from the plan alone, for features without a free try (no usage counters needed). */
export function featureLock(plan: PlanSummary | null | undefined, feature: PlanFeature): PaidPlanKey | null {
  if (!plan || !plan.enforced) return null;
  const min = FEATURE_MIN_PLAN[feature];
  return RANK[plan.plan] >= RANK[min] ? null : min;
}

interface PlanRefusal {
  plan: PaidPlanKey;
  feature: string | null;
  limit: number | null;
}

/** A `plan_required` refusal from an API error body, or null for any other error. */
export function planRefusalIn(body: string): PlanRefusal | null {
  try {
    const parsed = JSON.parse(body) as { error?: string; message?: unknown };
    // Nest puts the object either at the top or under `message`.
    const err = (parsed.error === 'plan_required' ? parsed : parsed.message) as { error?: string; plan?: string; feature?: unknown; limit?: unknown } | undefined;
    if (err?.error !== 'plan_required') return null;
    return {
      plan: err.plan === 'plus' || err.plan === 'business' ? err.plan : 'start',
      feature: typeof err.feature === 'string' ? err.feature : null,
      limit: typeof err.limit === 'number' ? err.limit : null
    };
  } catch {
    return null;
  }
}

export const planRequiredIn = (body: string): PaidPlanKey | null => planRefusalIn(body)?.plan ?? null;
