import { ForbiddenException, HttpException, HttpStatus, Injectable, NestMiddleware, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { and, eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type { NextFunction, Request, Response } from "express";
import * as schema from "../../drizzle/schema";
import { AI_SERVICE_SCOPE } from "../auth/service-token.guard";
import { verifyBearerToken } from "../auth/verify-bearer-token";
import { DbService } from "../db/db.service";
import { drizzleTx } from "../db/drizzle-tx";

/** How long the companies of an ended class stay (read-only), as in migration 0071. */
const CLASSROOM_GRACE_MS = 30 * 24 * 3600 * 1000;

export type DashboardRole = "owner" | "admin" | "accountant" | "viewer";

export interface AuthenticatedUser {
  /**
   * `users.id` for a human/service JWT (from the verified token's `sub`
   * claim), or the API key's OWN id for the API-key auth path
   * (`src/auth/api-key-auth.guard.ts`) — that path has no `users.id` to
   * report at all (an API key is a machine credential, not a user).
   */
  id: string;
  /**
   * Optional: only ever populated for the JWT paths (human dashboard user
   * or the AI-service credential), which carry a verified `email` claim —
   * see `verify-bearer-token.ts`. The API-key auth path
   * (`src/auth/api-key-auth.guard.ts`, `src/api-keys/api-key-tenant-
   * resolver.middleware.ts`) has no email to report and leaves this unset;
   * nothing in this codebase currently branches on it being present, so
   * making it optional (rather than a fabricated placeholder string) is the
   * honest shape.
   */
  email?: string;
  /**
   * Resolved fresh per request from the `X-Tenant-Id` header + a
   * `tenant_memberships` lookup (human users), from the AI-service's
   * pre-resolved request body (service credential), or from the API key's
   * own `tenant_id` column (API-key auth path) — see this file's class doc
   * comment. NEVER taken directly from a JWT claim.
   */
  tenantId: string;
  /**
   * `"service"` marks the AI microservice's static `BACKEND_SERVICE_JWT`
   * credential, which has no backing `tenant_memberships` row (it is not a
   * human user acting under a membership) — see the class doc comment.
   * `"admin"` is also used as a documented placeholder role for the
   * API-key auth path (see `ApiKeyAuthGuard`'s doc comment) — an API key
   * likewise has no `tenant_memberships` row.
   */
  role: DashboardRole | "service";
  /** Per-area overrides of the role's defaults (`tenant_memberships.permissions`), see permissions.ts. */
  permissions?: unknown;
  /** The dashboard session passed the two-factor check (JWT `mfa` claim). Unset for API keys and the AI service. */
  twoFactor?: boolean;
  /** The company is a demo playground (see `src/demo/`); `DemoGuard` narrows what it may do. */
  demo?: boolean;
  /** A practice company of a class (see `src/classroom/`); always `demo` too. */
  classroom?: boolean;
  /** The class has ended: its companies are read-only until they are deleted. */
  classroomReadOnly?: boolean;
}

export interface TenantScopedRequest extends Request {
  /** Populated by `TenantContextMiddleware` (or, partially, by `JwtAuthGuard` — see its doc comment). */
  user?: AuthenticatedUser;
  /**
   * A Drizzle instance bound to a connection reserved exclusively for this
   * request, with `app.current_tenant_id` already set for the lifetime of
   * the open transaction. ALL tenant-scoped queries in a request handler
   * must go through this, never through `DbService.db` (the shared pool).
   */
  tenantDb?: PostgresJsDatabase<typeof schema>;
}

/** Literal scope claim identifying the AI microservice's service credential — see `verify-bearer-token.ts`. */

/**
 * Enforces the multi-tenancy model from blueprint §4, refined per the
 * backend-JWT redesign: the JWT carries ONLY user identity (`sub`, `email`)
 * — never a tenant id — because a user can belong to several tenants
 * (`tenant_memberships`) and that membership can change at any moment after
 * the token was minted. A JWT claim baked in at issue time cannot reflect a
 * membership change that happens seconds later, for the token's entire
 * (short) lifetime. So instead, THIS middleware resolves + authorizes the
 * active tenant fresh on every single request:
 *
 *   1. Verify the bearer JWT (signature + expiry) — see `verify-bearer-token.ts`.
 *   2. Read the REQUIRED `X-Tenant-Id` request header — the tenant the
 *      caller is asking to act as for this request.
 *   3. Query `tenant_memberships` to confirm the JWT's user id is actually a
 *      member of that tenant. If not: `403 Forbidden`. Never trust the
 *      header alone — it's arbitrary client input.
 *   4. Only once membership is confirmed does `SET LOCAL app.current_tenant_id`
 *      get applied for the rest of the request.
 *
 * EXCEPTION — the AI microservice: its `BACKEND_SERVICE_JWT` is a single
 * static, narrowly-scoped credential (blueprint §6/§8), not minted per user
 * and not backed by any `tenant_memberships` row. It carries a distinguishing
 * `scope: "ai-service"` claim (verified above, never forgeable without
 * `JWT_SECRET`) and separately resolves its target tenant out-of-band via
 * `POST /api/v1/internal/channel-links/verify` (blueprint §6 step 2), supplying it
 * directly in the request body. Once step 1 has confirmed the bearer token
 * is genuinely that service credential — never a human token, never a
 * superuser/admin token — trusting its body-supplied `tenant_id` is safe by
 * construction; skip the `tenant_memberships` check for this caller only
 * (there is no membership row to check).
 *
 * ============================================================================
 * THE CRUX OF THE SECURITY MODEL — read this before touching this file.
 * ============================================================================
 * Postgres `SET LOCAL` (and the equivalent `set_config(..., true)` used
 * below) is scoped to the CURRENT TRANSACTION on the CURRENT SESSION/
 * CONNECTION. It is not a global session setting, has no effect once that
 * transaction ends, and — critically — has NO effect on any other
 * connection. A connection pool hands out whichever physical connection is
 * free; two queries issued "in the same request" can easily run on two
 * different physical connections unless you go out of your way to prevent
 * it.
 *
 * The required pattern, implemented below:
 *   1. Open a transaction via `postgres.js`'s `sql.begin(callback)`, which
 *      itself reserves a single dedicated connection from the pool for the
 *      duration of `callback`.
 *   2. Tentatively `set_config('app.current_tenant_id', <candidate>, true)`
 *      to the CANDIDATE tenant id from the `X-Tenant-Id` header, then
 *      immediately query `tenant_memberships` filtered by BOTH that tenant
 *      id and the verified user id. This is safe even though the header is
 *      unverified client input: setting it doesn't grant anything by
 *      itself — RLS on `tenant_memberships` only makes rows for THAT tenant
 *      visible at all, and the explicit `userId` filter on top of that means
 *      a non-member gets zero rows back regardless of which real tenant id
 *      they guessed. `req.tenantDb`/`next()` are only reached after that
 *      check passes.
 *   3. Keep the transaction open for the entire downstream request/response
 *      cycle by calling `next()` *inside* the `sql.begin()` callback and
 *      only resolving the callback's promise once the response finishes —
 *      `sql.begin()` then commits (or rolls back on error, e.g. the
 *      `ForbiddenException` thrown for a non-member) and returns the
 *      connection to the pool automatically.
 *
 * Skipping any of this — e.g. querying through `DbService.db` (the shared
 * pool) instead of the transaction-bound instance — silently defeats RLS.
 * There is no way to detect that mistake from the query's result alone (you
 * just get zero rows), so it is worth over-commenting: always use
 * `req.tenantDb` in tenant-scoped controllers/services, never `DbService.db`.
 */
@Injectable()
export class TenantContextMiddleware implements NestMiddleware {
  constructor(
    private readonly dbService: DbService,
    private readonly jwtService: JwtService,
  ) {}

  async use(req: TenantScopedRequest, res: Response, next: NextFunction): Promise<void> {
    let identity;
    try {
      identity = verifyBearerToken(this.jwtService, req.headers.authorization);
    } catch (err) {
      next(err as Error);
      return;
    }

    try {
      if (identity.scope === AI_SERVICE_SCOPE) {
        await this.handleServiceRequest(req, res, next, identity.sub, identity.email);
      } else {
        await this.handleDashboardUserRequest(req, res, next, identity.sub, identity.email, identity.twoFactor === true);
      }
    } catch (err) {
      next(err as Error);
    }
  }

  /**
   * AI microservice path — see the class doc comment's "EXCEPTION" section.
   * `tenant_id` comes straight from the request body (already resolved by
   * the caller via `POST /api/v1/internal/channel-links/verify`); no
   * `tenant_memberships` row exists to check against for a service
   * credential.
   */
  private async handleServiceRequest(
    req: TenantScopedRequest,
    res: Response,
    next: NextFunction,
    serviceSubject: string,
    serviceEmail: string,
  ): Promise<void> {
    const body = req.body as { tenantId?: string; tenant_id?: string } | undefined;
    const tenantId = body?.tenantId ?? body?.tenant_id;
    if (!tenantId) {
      throw new UnauthorizedException("Missing tenant_id in AI-service request body");
    }

    await this.dbService.sql.begin(async (tx) => {
      await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;
      // Who the audit log credits (audit_log column defaults).
      await tx`SELECT set_config('app.current_actor', 'ai', true)`;

      req.user = { id: serviceSubject, email: serviceEmail, tenantId, role: "service" };
      req.tenantDb = drizzleTx(tx, schema);

      await new Promise<void>((resolve, reject) => {
        res.once("finish", resolve);
        res.once("close", resolve);
        res.once("error", reject);
        next();
      });
    });
  }

  /**
   * Human dashboard user path — required `X-Tenant-Id` header, verified
   * against `tenant_memberships` (see the class doc comment for the exact
   * mechanics and why this is safe despite the header being unverified
   * client input).
   */
  private async handleDashboardUserRequest(
    req: TenantScopedRequest,
    res: Response,
    next: NextFunction,
    userId: string,
    email: string,
    twoFactor: boolean,
  ): Promise<void> {
    const tenantIdHeader = req.headers["x-tenant-id"];
    const candidateTenantId = Array.isArray(tenantIdHeader) ? tenantIdHeader[0] : tenantIdHeader;

    if (!candidateTenantId) {
      throw new UnauthorizedException(
        "Missing X-Tenant-Id header — a user may belong to multiple tenants, so every " +
          "request must say which one it's acting as",
      );
    }

    await this.dbService.sql.begin(async (tx) => {
      // Tentative: see the class doc comment's step 2 for why setting this
      // BEFORE the membership check is safe.
      await tx`SELECT set_config('app.current_tenant_id', ${candidateTenantId}, true)`;
      // Who the audit log credits (audit_log column defaults).
      await tx`SELECT set_config('app.current_user_id', ${userId}, true), set_config('app.current_actor', 'user', true)`;

      const membershipDb = drizzleTx(tx, schema);
      const [membership] = await membershipDb
        .select({ role: schema.tenantMemberships.role, permissions: schema.tenantMemberships.permissions })
        .from(schema.tenantMemberships)
        .where(
          and(
            eq(schema.tenantMemberships.tenantId, candidateTenantId),
            eq(schema.tenantMemberships.userId, userId),
          ),
        )
        .limit(1);

      if (!membership) {
        throw new ForbiddenException(
          "User does not belong to the requested tenant (X-Tenant-Id) — a JWT proves who " +
            "you are, never which tenant you're allowed to act as",
        );
      }

      const [tenant] = await membershipDb
        .select({
          isDemo: schema.tenants.isDemo,
          demoExpiresAt: schema.tenants.demoExpiresAt,
          classroomClassId: schema.tenants.classroomClassId,
        })
        .from(schema.tenants)
        .where(eq(schema.tenants.id, candidateTenantId))
        .limit(1);
      // An expired demo waits for the cleanup job; nobody works in it meanwhile.
      if (tenant?.isDemo && (!tenant.demoExpiresAt || tenant.demoExpiresAt.getTime() <= Date.now())) {
        throw new HttpException("demo_expired", HttpStatus.GONE);
      }
      const classroom = tenant?.isDemo === true && tenant.classroomClassId !== null;
      // A practice company is deleted CLASSROOM_GRACE_DAYS after its class ends (classroom_join).
      const classroomReadOnly =
        classroom && tenant!.demoExpiresAt!.getTime() - CLASSROOM_GRACE_MS <= Date.now();

      req.user = {
        id: userId,
        email,
        tenantId: candidateTenantId,
        role: membership.role,
        permissions: membership.permissions,
        twoFactor,
        demo: tenant?.isDemo === true,
        classroom,
        classroomReadOnly,
      };
      req.tenantDb = membershipDb;

      await new Promise<void>((resolve, reject) => {
        res.once("finish", resolve);
        res.once("close", resolve);
        res.once("error", reject);
        next();
      });
    });
  }
}
