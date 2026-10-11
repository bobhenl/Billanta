import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import type { TenantScopedRequest } from "../tenancy/tenant-context.middleware";

/**
 * Restricts backup-destination management to tenant OWNERs (per this
 * feature's spec: "each tenant OWNER should be able to..."). No equivalent
 * role-gating guard exists elsewhere in this codebase yet (every other
 * dashboard endpoint is open to any tenant member — see
 * `TenantContextMiddleware`'s `DashboardRole` union for the roles that
 * exist: `owner | admin | accountant | viewer`), so this is a new, narrow
 * guard rather than a generic `RolesGuard` — reconnecting a Google Drive
 * account or rotating a webhook secret genuinely is a more sensitive,
 * owner-level action (it grants a background job standing write access to
 * an external account/URL) than the read/write-invoice-data actions every
 * other role can already do.
 *
 * Must run AFTER `TenantContextMiddleware` (needs `req.user.role`), same
 * ordering requirement `SubscriptionActiveGuard` documents for itself.
 */
@Injectable()
export class OwnerOnlyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<TenantScopedRequest>();

    if (req.user?.role !== "owner") {
      throw new ForbiddenException(
        "Only the tenant owner can manage backup destinations",
      );
    }
    return true;
  }
}
