import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { areaForPath, effectivePermissions } from "./permissions";
import type { TenantScopedRequest } from "./tenant-context.middleware";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** The member's own account and preferences: every role may change these. */
const PERSONAL_PREFIXES = ["v1/me", "v1/dashboard/config", "v1/invitations"];

/**
 * Company administration. Accountants work with documents, the bank and exports
 * (Settings → Team promises exactly that) but never manage these.
 */
const ADMIN_PREFIXES = ["v1/tenants", "v1/team", "v1/api-keys", "v1/billing", "v1/backup-destinations", "v1/ai/settings", "v1/channel-links"];

const under = (path: string, prefix: string) => path === prefix || path.startsWith(`${prefix}/`);

/**
 * Whether `role` (with its per-area `permissions` overrides) may send `method`
 * to `path` (no `/api/` prefix, no query). Owners and admins may do anything.
 * Areas (invoices, contacts, expenses, bank, reports) follow the member's
 * permission level: `read` allows reads, `write` everything, `none` nothing.
 * Outside those areas reads are open and writes follow the role.
 */
export function roleMayAccess(role: string, method: string, path: string, permissions?: unknown): boolean {
  const safe = SAFE_METHODS.has(method.toUpperCase());
  if (role === "owner" || role === "admin" || role === "service") return true;
  if (PERSONAL_PREFIXES.some((p) => under(path, p))) return true;
  const area = areaForPath(path);
  if (area) {
    const levelFor = effectivePermissions(role, permissions)[area];
    return safe ? levelFor !== "none" : levelFor === "write";
  }
  if (safe) return true;
  // Anyone may found another company of their own.
  if (method.toUpperCase() === "POST" && path === "v1/tenants") return true;
  if (role === "accountant") return !ADMIN_PREFIXES.some((p) => under(path, p));
  return false;
}

/** Backwards-compatible name for role-only checks. */
export const roleMayWrite = (role: string, method: string, path: string) => roleMayAccess(role, method, path);

/**
 * Global guard enforcing the dashboard roles on every tenant route. Runs after
 * `TenantContextMiddleware`, which sets `req.user.role` and `permissions`;
 * requests without a user (public invoice pages, webhooks, sign-in) are left
 * to their own guards.
 */
@Injectable()
export class RoleAccessGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== "http") return true;
    const req = context.switchToHttp().getRequest<TenantScopedRequest>();
    const role = req.user?.role;
    if (!role) return true;
    const path = (req.originalUrl ?? req.url ?? "").split("?")[0].replace(/^\/+/, "").replace(/^api\//, "").replace(/\/+$/, "");
    if (roleMayAccess(role, req.method, path, req.user?.permissions)) return true;
    throw new ForbiddenException(
      role === "viewer" ? "Your role is read-only in this company" : "Your access in this company doesn't allow this",
    );
  }
}
