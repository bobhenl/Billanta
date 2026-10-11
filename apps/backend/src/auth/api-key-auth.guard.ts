import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import type { Request } from "express";
import { apiKeyAllowsMethod } from "../api-keys/api-key.util";
import { ApiKeysService } from "../api-keys/api-keys.service";
import type { AuthenticatedUser } from "../tenancy/tenant-context.middleware";

type ApiKeyScopedRequest = Request & { user?: AuthenticatedUser };

/**
 * Public-API authentication guard: `Authorization: Bearer sk_live_...`.
 *
 * ============================================================================
 * DESIGN NOTE FOR WHOEVER RECONCILES THIS WITH THE JWT/TENANT-MEMBERSHIP WORK
 * ============================================================================
 * This guard is built to be fully self-contained on purpose — it does not
 * assume anything about how JWT auth or tenant-membership resolution work
 * internally, because that landed concurrently in `jwt-auth.guard.ts`/
 * `tenant-context.middleware.ts`. An API key needs none of that: it carries
 * its OWN `tenant_id` column (`drizzle/schema.ts`), so "which tenant is this
 * request for" is a direct, single-row lookup with no membership check —
 * unlike a human JWT, there is no "which of this user's several tenants"
 * question to answer.
 *
 * The one thing this guard DOES assume, and must be reconciled if it turns
 * out wrong: `tenant-context.middleware.ts` currently declares
 * `AuthenticatedUser = { id: string; email: string; tenantId: string; role:
 * DashboardRole | "service" }`. This guard reuses that exact shape (down to
 * the `"service"` role value, the same one used for the AI microservice's
 * static credential — see that file's class doc comment) rather than
 * inventing a parallel one, since `SubscriptionActiveGuard` and every
 * JWT-guarded controller already read `req.user.tenantId` expecting it.
 * `id` here is the API key's OWN id (`api_keys.id`), not a `users.id` —
 * do not feed it into a `users` FK (e.g. a future `issued_by_user_id`)
 * without resolving that mismatch first. `email` has no real value for a
 * machine credential; `AuthenticatedUser.email` ended up optional in the
 * final shape (see that interface's doc comment), so `""` here is a
 * deliberate explicit choice, not a workaround for a required field.
 *
 * ============================================================================
 * ORDERING CAVEAT — read `ApiKeyOrJwtTenantContextMiddleware`'s doc comment
 * too.
 * ============================================================================
 * Nest's lifecycle is middleware -> guards. `TenantContextMiddleware`
 * (which runs on every `InvoicesController` route) unconditionally verifies
 * the bearer token as a JWT and throws before this guard would ever run, for
 * ANY non-JWT credential — including a valid API key. That means API-key
 * resolution MUST also happen at the middleware layer for routes with no
 * request body to fall back to (e.g. `GET /v1/invoices`). See
 * `ApiKeyOrJwtTenantContextMiddleware`
 * (apps/backend/src/api-keys/api-key-or-jwt-tenant-context.middleware.ts),
 * registered ahead of `TenantContextMiddleware` in `AppModule.configure()`
 * for exactly the two routes this guard is wired onto via
 * `CombinedAuthGuard`.
 *
 * This guard is still fully self-contained and correct on its own: if
 * `req.user` is already populated (the middleware ran first, the normal
 * case for these two routes), it trusts that and just fires the
 * `last_used_at` touch; if not (e.g. this guard is ever reused on a route
 * the middleware isn't registered for), it performs the complete lookup
 * itself. Both paths are exercised in `api-key-auth.guard.spec.ts`.
 */
@Injectable()
export class ApiKeyAuthGuard implements CanActivate {
  constructor(private readonly apiKeysService: ApiKeysService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<ApiKeyScopedRequest>();

    // Already resolved by ApiKeyOrJwtTenantContextMiddleware — trust it
    // rather than hitting the database a second time for the same request.
    if (req.user?.tenantId) {
      this.apiKeysService.touchLastUsed(req.user.tenantId, req.user.id);
      return true;
    }

    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      throw new UnauthorizedException("Missing bearer token");
    }

    const rawKey = authHeader.slice("Bearer ".length).trim();
    if (!rawKey) {
      throw new UnauthorizedException("Missing bearer token");
    }

    const result = await this.apiKeysService.validateKey(rawKey);
    if (!result) {
      // Unknown and revoked keys are indistinguishable here on purpose —
      // see find_active_api_key_by_hash's doc comment in rls-policies.sql.
      throw new UnauthorizedException("Invalid or revoked API key");
    }

    if (!apiKeyAllowsMethod(result.scopes, req.method)) {
      throw new ForbiddenException("This API key is read-only");
    }

    const body = req.body as { tenantId?: string; tenant_id?: string } | undefined;
    const bodyTenantId = body?.tenantId ?? body?.tenant_id;
    if (bodyTenantId && bodyTenantId !== result.tenantId) {
      // Authenticated fine (the key itself is valid) but not authorized to
      // act as a different tenant than the one it's scoped to — 403, not
      // 401, since this is an authorization failure, not an authentication
      // one.
      throw new ForbiddenException(
        "Request body tenant_id does not match the API key's own tenant",
      );
    }

    req.user = { id: result.apiKeyId, email: "", tenantId: result.tenantId, role: "service" };
    this.apiKeysService.touchLastUsed(result.tenantId, result.apiKeyId);
    return true;
  }
}
