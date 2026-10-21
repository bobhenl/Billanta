import {
  applyDecorators,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UseGuards,
} from "@nestjs/common";
import { eq } from "drizzle-orm";
import * as schema from "../../drizzle/schema";
import type { TenantScopedRequest } from "../tenancy/tenant-context.middleware";

/**
 * Plan-gating guard (blueprint §5): "a NestJS guard checks
 * subscription_status on invoice-creation/AI-ingestion endpoints;
 * past_due -> read-only; canceled -> export-only."
 *
 * This guard implements the binary gate: `active`/`trialing` -> allowed,
 * anything else -> `ForbiddenException`. It deliberately does NOT
 * implement the finer read-only-vs-export-only distinction across every
 * other endpoint in the API (a `past_due` tenant should still be able to
 * view or export existing invoices, just not create new ones; a
 * `canceled` tenant should only be able to export) — that full
 * enforcement sweep is explicitly out of scope for this change. This
 * guard is the single representative example wired up on the endpoint
 * blueprint §5 names first: invoice creation
 * (`InvoicesController.createDraft`).
 *
 * Ordering requirement: must run AFTER `TenantContextMiddleware` (it
 * needs `req.tenantDb` to already be set) — the same ordering caveat
 * `JwtAuthGuard` documents for itself.
 */
@Injectable()
export class SubscriptionActiveGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<TenantScopedRequest>();

    if (!req.tenantDb) {
      throw new ForbiddenException(
        "SubscriptionActiveGuard requires TenantContextMiddleware to run first (no req.tenantDb) " +
          "– check the route is listed in AppModule's TenantContextMiddleware.forRoutes(...)",
      );
    }

    // Same two tenant-resolution paths as
    // `TenantContextMiddleware.resolveTenantId` (dashboard user JWT claim
    // vs. AI-service body-supplied tenantId) — see that method's doc
    // comment for the full explanation of why both exist.
    const body = req.body as { tenantId?: string; tenant_id?: string } | undefined;
    const tenantId = req.user?.tenantId ?? body?.tenantId ?? body?.tenant_id;

    if (!tenantId) {
      throw new ForbiddenException("No tenant context available to check subscription status");
    }

    // req.tenantDb already has app.current_tenant_id = tenantId set for
    // this transaction (TenantContextMiddleware), so RLS already restricts
    // this SELECT to at most the one row for this tenant.
    const [tenant] = await req.tenantDb
      .select({ status: schema.tenants.subscriptionStatus })
      .from(schema.tenants)
      .where(eq(schema.tenants.id, tenantId))
      .limit(1);

    if (!tenant) {
      throw new ForbiddenException("Tenant not found");
    }

    if (tenant.status === "active" || tenant.status === "trialing") {
      return true;
    }

    throw new ForbiddenException(
      `Subscription status '${tenant.status}' does not permit this action. ` +
        "'past_due' tenants are read-only; 'canceled' tenants are export-only (blueprint §5).",
    );
  }
}

/** Convenience decorator equivalent to `@UseGuards(SubscriptionActiveGuard)`. */
export function RequireActiveSubscription(): MethodDecorator & ClassDecorator {
  return applyDecorators(UseGuards(SubscriptionActiveGuard));
}
