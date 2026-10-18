import {
  applyDecorators,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UseGuards,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { and, count, eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "../../drizzle/schema";
import type { TenantScopedRequest } from "../tenancy/tenant-context.middleware";
import { planAllows, planSummary, type PlanSummary } from "./plan-access";
import { FEATURE_MIN_PLAN, FREE_RECURRING_TEMPLATES, type PlanFeature } from "./plans";

type TenantDb = PostgresJsDatabase<typeof schema>;

export const PLAN_FEATURE_KEY = "billing:plan-feature";

/** The `tenants` columns `planSummary` needs, read through the request's RLS-bound connection. */
export async function loadPlanSummary(db: TenantDb, tenantId: string, now = new Date()): Promise<PlanSummary | null> {
  const [t] = await db
    .select({
      planEnforced: schema.tenants.planEnforced,
      trialPlan: schema.tenants.trialPlan,
      trialStartedAt: schema.tenants.trialStartedAt,
      trialEndsAt: schema.tenants.trialEndsAt,
      prepaidPlan: schema.tenants.prepaidPlan,
      prepaidUntil: schema.tenants.prepaidUntil,
      subscriptionPlan: schema.tenants.subscriptionPlan,
      subscriptionStatus: schema.tenants.subscriptionStatus,
    })
    .from(schema.tenants)
    .where(eq(schema.tenants.id, tenantId))
    .limit(1);
  return t ? planSummary(t, now) : null;
}

/**
 * Refuses a write that needs a higher plan with 403 `plan_required`. Put it
 * only on routes that create or switch something on: reads, edits of what
 * already exists and deletes stay open, so a company whose trial ended keeps
 * every record and can still look at it and clean it up.
 *
 * Runs after `TenantContextMiddleware` (needs `req.tenantDb`).
 */
@Injectable()
export class PlanFeatureGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const feature = this.reflector.get<PlanFeature | "recurring_templates" | undefined>(PLAN_FEATURE_KEY, context.getHandler());
    if (!feature) return true;
    const req = context.switchToHttp().getRequest<TenantScopedRequest>();
    const tenantId = req.user?.tenantId;
    if (!req.tenantDb || !tenantId) return true; // the auth guards refuse these anyway
    const summary = await loadPlanSummary(req.tenantDb, tenantId);
    if (!summary || !summary.enforced) return true;

    if (feature === "recurring_templates") {
      if (summary.plan !== "free") return true;
      const [row] = await req.tenantDb
        .select({ n: count() })
        .from(schema.recurringInvoiceTemplates)
        .where(and(eq(schema.recurringInvoiceTemplates.tenantId, tenantId), eq(schema.recurringInvoiceTemplates.isActive, true)));
      if ((row?.n ?? 0) < FREE_RECURRING_TEMPLATES) return true;
      throw new ForbiddenException({ error: "plan_required", message: "This needs a paid plan", feature, plan: "start", limit: FREE_RECURRING_TEMPLATES });
    }

    if (planAllows(summary, feature)) return true;
    throw new ForbiddenException({ error: "plan_required", message: "This needs a higher plan", feature, plan: FEATURE_MIN_PLAN[feature] });
  }
}

/** `@RequirePlan("bank_sync")` on a create/enable route. */
export function RequirePlan(feature: PlanFeature | "recurring_templates"): MethodDecorator {
  return applyDecorators(SetMetadata(PLAN_FEATURE_KEY, feature), UseGuards(PlanFeatureGuard));
}
