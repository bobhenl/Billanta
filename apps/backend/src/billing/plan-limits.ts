import { ForbiddenException } from "@nestjs/common";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "../../drizzle/schema";
import { featureAccess, planAllows } from "./plan-access";
import { loadPlanSummary } from "./plan.guard";
import { FEATURE_MIN_PLAN, FEATURE_TASTE, PLAN_LIMITS, upgradeFor, type PlanFeature } from "./plans";
import { remaining, tasteCounter, usageLimit, usagePeriod, type UsageMetric } from "./usage";
import { consumeUsage, readUsage } from "./usage.repository";

type TenantDb = PostgresJsDatabase<typeof schema>;

function planRequired(feature: PlanFeature, extra: Record<string, unknown> = {}) {
  return new ForbiddenException({ error: "plan_required", message: "This needs a higher plan", feature, plan: FEATURE_MIN_PLAN[feature], ...extra });
}

/**
 * Refuses `feature` below its plan with 403 `plan_required`. For routes
 * that can't use `@RequirePlan` because only part of what they do is gated
 * (e.g. adding a webhook, not removing one).
 */
export async function assertPlanFeature(db: TenantDb, tenantId: string, feature: PlanFeature): Promise<void> {
  const summary = await loadPlanSummary(db, tenantId);
  if (!summary || planAllows(summary, feature)) return;
  throw planRequired(feature);
}

/**
 * One use of a feature that has a taste (FEATURE_TASTE): free on its plan,
 * otherwise it spends one of the taste uses or is refused with 403
 * `plan_required` (with `taste` saying what the lower plan gets). Call it
 * right before the file goes out: the request transaction commits even when
 * the route later fails, so a use spent earlier would be lost on a 404.
 */
export async function spendFeature(db: TenantDb, tenantId: string, feature: PlanFeature, now = new Date()): Promise<"plan" | "taste"> {
  const summary = await loadPlanSummary(db, tenantId, now);
  if (!summary || planAllows(summary, feature)) return "plan";
  const counter = tasteCounter(feature, now);
  if (counter) {
    const spent = await consumeUsage(db, tenantId, counter.metric, counter.period, counter.uses);
    if (spent.ok) return "taste";
  }
  throw planRequired(feature, counter ? { taste: FEATURE_TASTE[feature] } : {});
}

/**
 * Counts one issued document. Free (enforced) stops at its monthly limit with
 * 403 `plan_required` / `feature: "documents"`; every other company is
 * counted too, so the dashboard can show the month's number.
 */
export async function countIssuedDocument(db: TenantDb, tenantId: string, now = new Date()): Promise<void> {
  const summary = await loadPlanSummary(db, tenantId, now);
  const limit = usageLimit(summary, "documents");
  const spent = await consumeUsage(db, tenantId, "documents", usagePeriod(now), limit);
  if (spent.ok) return;
  throw new ForbiddenException({
    error: "plan_required",
    message: "The monthly document limit of this plan is used up",
    feature: "documents",
    plan: upgradeFor("documents", summary!.plan) ?? "start",
    limit,
  });
}

export interface UsageMeter {
  used: number;
  limit: number | null;
  remaining: number | null;
}

/** This month's counters and what is left of each taste, for the dashboard. */
export async function usageOverview(db: TenantDb, tenantId: string, now = new Date()) {
  const summary = await loadPlanSummary(db, tenantId, now);
  const period = usagePeriod(now);
  const tastes = (Object.keys(FEATURE_TASTE) as PlanFeature[]).map((f) => ({ feature: f, counter: tasteCounter(f, now)! }));
  const monthly: UsageMetric[] = ["documents", "ai_credits", "api_requests", ...tastes.filter((t) => t.counter.period === period).map((t) => t.counter.metric)];
  const lifetime = tastes.filter((t) => t.counter.period !== period).map((t) => t.counter.metric);
  const rows = [...(await readUsage(db, tenantId, monthly, period)), ...(await readUsage(db, tenantId, lifetime, "all"))];
  const used = (metric: string) => rows.find((r) => r.metric === metric)?.count ?? 0;
  const meter = (resource: "documents" | "ai_credits" | "api_requests"): UsageMeter => {
    const limit = usageLimit(summary, resource);
    return { used: used(resource), limit, remaining: remaining(limit, used(resource)) };
  };
  return {
    period,
    plan: summary?.plan ?? "free",
    enforced: summary?.enforced ?? false,
    documents: meter("documents"),
    aiCredits: meter("ai_credits"),
    apiRequests: meter("api_requests"),
    // Per gated feature: "plan" (included), "taste" (uses left) or "locked".
    features: Object.fromEntries(
      (Object.keys(FEATURE_MIN_PLAN) as PlanFeature[]).map((f) => {
        const counter = tasteCounter(f, now);
        const usedTaste = counter ? used(counter.metric) : 0;
        const access = summary ? featureAccess(summary, f, usedTaste) : "plan";
        return [f, { access, plan: FEATURE_MIN_PLAN[f], tasteLeft: counter && access !== "plan" ? Math.max(0, counter.uses - usedTaste) : null }];
      }),
    ) as Record<PlanFeature, { access: "plan" | "taste" | "locked"; plan: string; tasteLeft: number | null }>,
    partnersLimit: summary?.enforced ? PLAN_LIMITS.partners[summary.plan] : null,
  };
}
