import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import type { Request } from "express";
import { isApiKeyFormat } from "../api-keys/api-key.util";
import { ApiKeyAuthGuard } from "./api-key-auth.guard";
import { JwtAuthGuard } from "./jwt-auth.guard";

/**
 * OR-composition of `JwtAuthGuard` and `ApiKeyAuthGuard`: either a valid
 * dashboard JWT OR a valid `sk_live_...` API key authenticates the request.
 *
 * Nest 10 (the version pinned here — see package.json) has no built-in
 * "pass if ANY of these guards pass" helper: `@UseGuards(A, B)` is AND
 * (every guard must return true), not OR. The standard workaround — and
 * the one used here — is exactly what a composite guard like this one does:
 * a single `CanActivate` that internally tries each real guard and decides.
 *
 * Routing strategy: check the bearer token's SHAPE first (`sk_live_` prefix
 * -> API key) rather than always trying JWT first and catching failure.
 * By the time this guard runs on `InvoicesController`'s two combined-auth
 * routes, `req.user` has ALREADY been populated by middleware — either
 * `TenantContextMiddleware` (dashboard/AI-service JWT) or
 * `ApiKeyOrJwtTenantContextMiddleware` (API key) — see that class's doc
 * comment for why the tenant-resolution work has to happen at the
 * middleware layer, before any guard runs. `JwtAuthGuard.canActivate()`'s
 * first branch is simply `if (req.user) return true`, so in practice EITHER
 * guard would already succeed once middleware has run; shape-routing here
 * is kept anyway because (a) it's the more explicit, self-documenting
 * "which credential is this" check, and (b) it keeps this guard correct
 * even if reused on a route where the middleware hasn't (yet) run — the
 * `catch` fallback below still tries the other guard's OWN independent
 * validation path in that case, rather than assuming middleware involvement.
 *
 * RECONCILIATION NOTE: if the concurrent JWT/tenant-membership work changes
 * `JwtAuthGuard`'s constructor signature, or `AuthenticatedUser`'s shape in
 * `tenant-context.middleware.ts`, this class and `ApiKeyAuthGuard` /
 * `ApiKeyOrJwtTenantContextMiddleware` are the three places to update —
 * search this codebase for `role: "service"` (the placeholder role an API
 * key reports) and `AuthenticatedUser` to find every assumption.
 */
@Injectable()
export class CombinedAuthGuard implements CanActivate {
  constructor(
    private readonly jwtAuthGuard: JwtAuthGuard,
    private readonly apiKeyAuthGuard: ApiKeyAuthGuard,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const token = extractBearerToken(req);

    if (token && isApiKeyFormat(token)) {
      return this.apiKeyAuthGuard.canActivate(context);
    }

    try {
      return (await this.jwtAuthGuard.canActivate(context)) as boolean;
    } catch (jwtError) {
      if (!token) {
        throw jwtError;
      }
      try {
        return (await this.apiKeyAuthGuard.canActivate(context)) as boolean;
      } catch {
        // Surface the JWT error, not the API-key one — the token didn't
        // look like an API key, so "invalid JWT" is the more meaningful
        // message for the caller.
        throw jwtError;
      }
    }
  }
}

function extractBearerToken(req: Request): string | undefined {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    return undefined;
  }
  const token = authHeader.slice("Bearer ".length).trim();
  return token || undefined;
}
