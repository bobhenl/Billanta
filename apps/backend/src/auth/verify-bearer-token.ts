import { UnauthorizedException } from "@nestjs/common";
import type { JwtService } from "@nestjs/jwt";

/**
 * Decoded shape of the backend JWT this API accepts. Minted by the frontend
 * (`apps/frontend/lib/backend-token.ts`, via the `jose` library) once a
 * NextAuth session exists, using the shared `JWT_SECRET`.
 */
export interface BackendJwtPayload {
  /** `users.id` — the authenticated user's identity, nothing more. */
  sub: string;
  email: string;
  /**
   * Present ONLY on the AI microservice's static `BACKEND_SERVICE_JWT`
   * (blueprint §6/§8) — set to the literal `"ai-service"`. This is the
   * distinguishing marker `TenantContextMiddleware` uses to tell "this is
   * genuinely the scoped AI-service credential" apart from any human
   * dashboard token, so it's safe to trust a body-supplied `tenant_id` for
   * this caller only (see that file). A human dashboard JWT never carries
   * this claim.
   */
  scope?: string;
}

/**
 * Verifies the HS256 backend JWT carried as `Authorization: Bearer <token>`
 * and returns its identity claims, or throws `UnauthorizedException` if the
 * header is missing, the token is malformed/expired/invalid, or required
 * claims are absent.
 *
 * Deliberately does NOT read/trust a tenant-id claim, even though earlier
 * drafts of this scaffold's TODOs assumed one: a user can belong to several
 * tenants (`tenant_memberships`) and that membership can change at any
 * moment after this token was issued — a claim baked in at mint time would
 * go stale for the token's entire (short) lifetime. Tenant scoping is
 * instead resolved fresh, per request, from the `X-Tenant-Id` header,
 * checked against `tenant_memberships` — see `TenantContextMiddleware`.
 */
export function verifyBearerToken(
  jwtService: JwtService,
  authHeader: string | undefined,
): BackendJwtPayload {
  if (!authHeader?.startsWith("Bearer ") || authHeader.length <= "Bearer ".length) {
    throw new UnauthorizedException("Missing bearer token");
  }
  const token = authHeader.slice("Bearer ".length);

  let payload: unknown;
  try {
    payload = jwtService.verify(token, { algorithms: ["HS256"] });
  } catch {
    throw new UnauthorizedException("Invalid or expired token");
  }

  if (typeof payload !== "object" || payload === null) {
    throw new UnauthorizedException("Malformed token payload");
  }

  const record = payload as Record<string, unknown>;
  if (typeof record.sub !== "string" || typeof record.email !== "string") {
    throw new UnauthorizedException("Malformed token payload");
  }

  return {
    sub: record.sub,
    email: record.email,
    scope: typeof record.scope === "string" ? record.scope : undefined,
  };
}
