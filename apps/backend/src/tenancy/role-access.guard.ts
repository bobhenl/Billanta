import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { meetsRequirement, requirementFor } from "./permissions";
import type { TenantScopedRequest } from "./tenant-context.middleware";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * The member's own account and preferences: every role may change these.
 * `v1/demo`: switching the demo's team view, which the controller limits to demos.
 */
const PERSONAL_PREFIXES = ["v1/me", "v1/dashboard/config", "v1/invitations", "v1/demo", "v1/vault/me"];

/**
 * Company administration. Accountants work with documents, the bank and exports
 * (Settings → Team promises exactly that) but never manage these.
 */
export const ADMIN_PREFIXES = ["v1/tenants", "v1/team", "v1/api-keys", "v1/billing", "v1/backup-destinations", "v1/ai/settings", "v1/channel-links", "v1/referrals", "v1/vault"];

export const under = (path: string, prefix: string) => path === prefix || path.startsWith(`${prefix}/`);

/**
 * Owners and admins only, reads included: the "Po zdanění" report shows each
 * partner's income and taxes, which other members must not see.
 */
const OWNER_ADMIN_PREFIXES = ["v1/net-income", "v1/tenants/me/tax-model"];
const ownerAdminOnly = (path: string) => OWNER_ADMIN_PREFIXES.some((p) => under(path, p)) || /^v1\/invoices\/[^/]+\/(partner-shares|lock)$/.test(path);

/**
 * Whether `role` (with its `permissions` overrides) may send `method` to
 * `path` (no `/api/` prefix, no query). Owners and admins may do anything.
 * Areas follow the member's level (`read` allows reads, `write` writes,
 * `none` nothing) plus the finer actions `requirementFor` names (issue,
 * send, settings sections…). Outside the areas reads are open and writes
 * follow the role. `body` matters only for the company-settings patch.
 */
export function roleMayAccess(role: string, method: string, path: string, permissions?: unknown, body?: unknown): boolean {
  const safe = SAFE_METHODS.has(method.toUpperCase());
  if (ownerAdminOnly(path)) return role === "owner" || role === "admin";
  if (role === "owner" || role === "admin" || role === "service") return true;
  if (PERSONAL_PREFIXES.some((p) => under(path, p))) return true;
  const req = requirementFor(method, path, body);
  if (req === "admin") return false;
  if (req) return meetsRequirement(role, permissions, req);
  if (safe) return true;
  // Anyone may found another company of their own.
  if (method.toUpperCase() === "POST" && path === "v1/tenants") return true;
  if (role === "accountant") return !ADMIN_PREFIXES.some((p) => under(path, p));
  return false;
}

/**
 * The request path as the router matched it, normalised for prefix checks
 * (no `/api/` prefix, no query, no trailing slash).
 *   - An absolute-form request line (`POST http://x/api/v1/... HTTP/1.1`)
 *     puts the scheme and host into `originalUrl`, while Express still routes
 *     on the pathname, so they are stripped.
 *   - Lowercased: Express routing is case-insensitive, so `/api/v1/INVOICES`
 *     reaches the invoices controller and must hit the same area check.
 *   - `..` segments are deliberately not resolved: Express doesn't resolve
 *     them either, so resolving here would check a different route.
 */
export function guardPath(rawUrl: string): string {
  return rawUrl
    .split(/[?#]/)[0]!
    .replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]*/i, "")
    .toLowerCase()
    .replace(/^\/+/, "")
    .replace(/^api\//, "")
    .replace(/\/+$/, "");
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
    const path = guardPath(req.originalUrl ?? req.url ?? "");
    // Every tenant route lives under `v1/`; anything else means the URL was
    // not parsed the way the router parsed it, so refuse rather than guess.
    if (under(path, "v1") && roleMayAccess(role, req.method, path, req.user?.permissions, (req as { body?: unknown }).body)) return true;
    throw new ForbiddenException(
      role === "viewer" ? "Your role is read-only in this company" : "Your access in this company doesn't allow this",
    );
  }
}
