import type { PlanSummary } from "./plan-access";
import { FEATURE_TASTE, PLAN_LIMITS, type LimitedResource, type PlanFeature } from "./plans";

/** Rows of `tenant_usage` (migration 0105). Tastes are per feature. */
export type UsageMetric = "documents" | "ai_credits" | "api_requests" | `taste_${PlanFeature}`;

/** `period` for a lifetime allowance (a taste with `per: "ever"`). */
export const LIFETIME_PERIOD = "all";

/**
 * The calendar month in Prague as `YYYY-MM`: the counters reset at local
 * midnight on the 1st, which is when a Czech or Slovak customer expects it.
 */
export function usagePeriod(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Prague", year: "numeric", month: "2-digit" }).formatToParts(now);
  const year = parts.find((p) => p.type === "year")!.value;
  const month = parts.find((p) => p.type === "month")!.value;
  return `${year}-${month}`;
}

/**
 * The monthly limit a company is held to for `resource`; null means
 * unlimited. Companies from before plan limits (`enforced: false`) are
 * never limited.
 */
export function usageLimit(summary: Pick<PlanSummary, "plan" | "enforced"> | null, resource: LimitedResource): number | null {
  if (!summary || !summary.enforced) return null;
  return PLAN_LIMITS[resource][summary.plan];
}

/** The counter row a feature's taste uses, or null when the feature has none. */
export function tasteCounter(feature: PlanFeature, now: Date = new Date()): { metric: UsageMetric; period: string; uses: number } | null {
  const taste = FEATURE_TASTE[feature];
  if (!taste) return null;
  return { metric: `taste_${feature}`, period: taste.per === "month" ? usagePeriod(now) : LIFETIME_PERIOD, uses: taste.uses };
}

/** What is left of a limit; null for unlimited. Never negative. */
export function remaining(limit: number | null, used: number): number | null {
  return limit === null ? null : Math.max(0, limit - used);
}
