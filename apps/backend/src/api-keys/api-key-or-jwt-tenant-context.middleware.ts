import { ForbiddenException, Injectable, NestMiddleware, UnauthorizedException } from "@nestjs/common";
import type { NextFunction, Response } from "express";
import * as schema from "../../drizzle/schema";
import { DbService } from "../db/db.service";
import { drizzleTx } from "../db/drizzle-tx";
import { TenantContextMiddleware } from "../tenancy/tenant-context.middleware";
import type { TenantScopedRequest } from "../tenancy/tenant-context.middleware";
import { apiKeyAllowsMethod, isApiKeyFormat } from "./api-key.util";
import { ApiKeysService } from "./api-keys.service";

/**
 * ============================================================================
 * WHY THIS CLASS EXISTS — read before assuming it duplicates
 * TenantContextMiddleware or "fixing" it away.
 * ============================================================================
 * The public API's whole ask is: `GET /v1/invoices` and `POST
 * /v1/invoices/drafts` must accept EITHER a dashboard/AI-service JWT OR a
 * `sk_live_...` API key. The natural place to express that would be a guard
 * (`CombinedAuthGuard` — apps/backend/src/auth/combined-auth.guard.ts,
 * `ApiKeyAuthGuard` — apps/backend/src/auth/api-key-auth.guard.ts), but
 * guards run AFTER middleware in Nest's pipeline (middleware -> guards ->
 * ...), and `TenantContextMiddleware`
 * (apps/backend/src/tenancy/tenant-context.middleware.ts) — which runs on
 * every `InvoicesController` route — UNCONDITIONALLY calls
 * `verifyBearerToken()` as its very first step, with no bypass for a
 * differently-shaped credential. An `sk_live_...` string is not a valid JWT,
 * so `jwtService.verify()` throws, and `TenantContextMiddleware` rejects the
 * request with 401 BEFORE any guard — including a perfectly correct
 * `ApiKeyAuthGuard` — ever gets to run. A guard genuinely cannot fix this;
 * something has to intercept ahead of `TenantContextMiddleware` itself.
 *
 * Rather than editing `tenant-context.middleware.ts` (owned by a concurrent
 * change building the real JWT + tenant-membership resolution in that exact
 * file — editing it here risks a destructive merge with work-in-progress
 * this class can't see), this class WRAPS it via plain composition:
 *   - bearer token is NOT API-key-shaped (missing, or JWT-shaped) -> call
 *     `TenantContextMiddleware.use()` UNCHANGED, passing req/res/next
 *     straight through. 100% of the dashboard-user and AI-service logic
 *     (JWT verification, `X-Tenant-Id` + `tenant_memberships` check, the
 *     `sql.begin()`/`set_config()` transaction dance) is reused as-is, not
 *     reimplemented or forked.
 *   - bearer token IS API-key-shaped -> resolve tenant context directly
 *     from the key's own `tenant_id` column (no membership lookup needed —
 *     an API key IS tenant-scoped by definition) and open the identical
 *     `sql.begin()` + `set_config('app.current_tenant_id', ...)` transaction
 *     shape, so `req.tenantDb` ends up in exactly the state every downstream
 *     repository call already expects.
 *
 * ============================================================================
 * REQUEST-SHAPE ASSUMPTION — reconcile here if the other agent's landed
 * shape differs from what's read below.
 * ============================================================================
 * As of this writing, `tenant-context.middleware.ts` defines:
 *   `AuthenticatedUser = { id: string; email: string; tenantId: string;
 *   role: DashboardRole | "service" }`
 * where `"service"` marks the AI microservice's static credential (no
 * backing `tenant_memberships` row). An API key is architecturally the same
 * shape of exception — a machine credential with no membership row — so
 * `role: "service"` is reused rather than inventing a new category `req.
 * user.role` consumers would need to know about. `email` has no real value
 * for a machine credential; set to `""` rather than left undefined, since
 * the field is now required (non-optional) on `AuthenticatedUser`. `id` is
 * the API key's OWN id (`api_keys.id`), not a `users.id` — do not feed this
 * into a `users` FK (e.g. a future `invoices.issued_by_user_id`) without
 * resolving that mismatch first.
 *
 * If `tenant-context.middleware.ts`'s shape changes before this lands,
 * update the `req.user = {...}` assignment in `handleApiKeyRequest` below to
 * match — that's the one place this class depends on it.
 */
@Injectable()
export class ApiKeyOrJwtTenantContextMiddleware implements NestMiddleware {
  constructor(
    private readonly apiKeysService: ApiKeysService,
    private readonly dbService: DbService,
    private readonly tenantContextMiddleware: TenantContextMiddleware,
  ) {}

  async use(req: TenantScopedRequest, res: Response, next: NextFunction): Promise<void> {
    const authHeader = req.headers.authorization;
    const rawToken = authHeader?.startsWith("Bearer ")
      ? authHeader.slice("Bearer ".length).trim()
      : undefined;

    if (!rawToken || !isApiKeyFormat(rawToken)) {
      // Missing bearer token, or JWT-shaped — the entire dashboard-user /
      // AI-service path, reused unmodified.
      await this.tenantContextMiddleware.use(req, res, next);
      return;
    }

    try {
      await this.handleApiKeyRequest(req, res, next, rawToken);
    } catch (err) {
      next(err as Error);
    }
  }

  private async handleApiKeyRequest(
    req: TenantScopedRequest,
    res: Response,
    next: NextFunction,
    rawKey: string,
  ): Promise<void> {
    const result = await this.apiKeysService.validateKey(rawKey);
    if (!result) {
      // Unknown and revoked keys are indistinguishable here on purpose —
      // see find_active_api_key_by_hash's doc comment in rls-policies.sql.
      throw new UnauthorizedException("Invalid or revoked API key");
    }

    if (!apiKeyAllowsMethod(result.scopes, req.method)) {
      throw new ForbiddenException("This API key is read-only");
    }

    // Tenant-impersonation guard: `CreateInvoiceDraftDto` still carries a
    // required `tenant_id` field (the AI-service contract), and this same
    // field is how `TenantContextMiddleware`'s AI-service branch resolves
    // its tenant. An API key is tenant-scoped by its OWN `tenant_id`
    // column; if the body names a *different* tenant, reject outright
    // rather than letting the body value silently win.
    const body = req.body as { tenantId?: string; tenant_id?: string } | undefined;
    const bodyTenantId = body?.tenantId ?? body?.tenant_id;
    if (bodyTenantId && bodyTenantId !== result.tenantId) {
      throw new UnauthorizedException(
        "Request body tenant_id does not match the API key's own tenant",
      );
    }

    await this.dbService.sql.begin(async (tx) => {
      await tx`SELECT set_config('app.current_tenant_id', ${result.tenantId}, true)`;
      // Who the audit log credits (audit_log column defaults).
      await tx`SELECT set_config('app.current_actor', 'api_key', true)`;

      req.user = {
        id: result.apiKeyId,
        email: "",
        tenantId: result.tenantId,
        role: "service",
      };
      req.tenantDb = drizzleTx(tx, schema);

      // Fire-and-forget — see ApiKeysService.touchLastUsed's doc comment.
      this.apiKeysService.touchLastUsed(result.tenantId, result.apiKeyId);

      await new Promise<void>((resolve, reject) => {
        res.once("finish", resolve);
        res.once("close", resolve);
        res.once("error", reject);
        next();
      });
    });
  }
}
