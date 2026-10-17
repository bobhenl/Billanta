import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import type { AuthenticatedUser, TenantScopedRequest } from "../tenancy/tenant-context.middleware";
import { verifyBearerToken } from "./verify-bearer-token";

/**
 * Real JWT verification (blueprint §2/§4) — see `verify-bearer-token.ts` for
 * the actual signature/expiry check against `JWT_SECRET`.
 *
 * ORDERING NOTE (resolves the TODO the previous placeholder left open):
 * Nest's request pipeline runs middleware -> guards -> interceptors -> pipes
 * -> handler. On every route also covered by `TenantContextMiddleware`
 * (currently: `TenantsController`, `ContactsController`,
 * `InvoicesController` — see `AppModule.configure`), that middleware runs
 * BEFORE this guard and has already verified the JWT itself AND resolved +
 * authorized the active tenant (`X-Tenant-Id` header checked against
 * `tenant_memberships`), populating a fully tenant-scoped `req.user` (id,
 * email, tenantId, role). This guard detects that (`req.user` already set)
 * and just passes through — a token is never verified twice per request.
 *
 * For a route guarded by `JwtAuthGuard` alone, with NO
 * `TenantContextMiddleware` in front of it (currently only
 * `ChannelLinksController` — deliberately excluded from the middleware, see
 * that controller's and `AppModule.configure`'s comments: its whole job is
 * resolving a tenant that isn't known yet, or trusting a dashboard tenant id
 * without a further membership check), this guard is the ONLY verification
 * that runs. It still rejects a missing/invalid/expired token, and attaches
 * bare identity (`id`, `email`) to `req.user` — but it deliberately does NOT
 * (and safely cannot) populate `tenantId`/`role`: doing that correctly
 * requires the same `X-Tenant-Id` + `tenant_memberships` lookup
 * `TenantContextMiddleware` performs, which this guard does not duplicate.
 * `ChannelLinksController.createLinkingToken`'s reliance on
 * `req.user.tenantId` today is therefore a PRE-EXISTING GAP in that
 * controller's own tenant-resolution design (see its comments) — out of
 * scope for this change. Do not read `req.user.tenantId`/`.role` after only
 * this guard (and not the middleware) has run for a request.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwtService: JwtService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<TenantScopedRequest>();

    if (req.user) {
      // Already verified + tenant-scoped by TenantContextMiddleware.
      return true;
    }

    const identity = verifyBearerToken(this.jwtService, req.headers.authorization);
    // Partial population — see the class doc comment above for why
    // tenantId/role are intentionally absent here. The `as` cast is safe in
    // exactly one direction (AuthenticatedUser is structurally assignable
    // to this smaller object shape), which is what TypeScript checks for an
    // `as` assertion; it does not manufacture tenantId/role values.
    req.user = { id: identity.sub, email: identity.email, twoFactor: identity.twoFactor } as AuthenticatedUser;
    return true;
  }
}
