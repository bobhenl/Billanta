/**
 * Mints the short-lived HS256 JWT used to call the NestJS backend API
 * (blueprint §2/§4) — deliberately a SEPARATE mechanism from NextAuth's own
 * session (a database-backed session row/cookie, see `../auth.ts`).
 *
 * Why separate: NextAuth's session identifies "who is browsing the
 * dashboard right now" to Next.js itself; it's never sent to, or verified
 * by, the NestJS backend. The backend instead needs a stateless, portable,
 * signature-verifiable credential it can check against a shared secret
 * without querying the frontend's session store — a classic service-to-
 * service bearer token, minted fresh (and short-lived, to bound the blast
 * radius of a leaked token) from the current NextAuth session's user id.
 *
 * Deliberately does NOT embed a tenant id. A user can belong to several
 * tenants (`tenant_memberships`) and can be added to/removed from one at
 * any moment — baking a tenant id into this token would make it silently
 * stale the instant that happens, for the rest of the token's lifetime.
 * The backend instead resolves + authorizes the active tenant fresh on
 * every request from a required `X-Tenant-Id` header, checked against
 * `tenant_memberships` — see `apps/backend/src/tenancy/tenant-context.middleware.ts`.
 */
import { SignJWT } from "jose";

const TOKEN_TTL = "15m";

let cachedSecret: Uint8Array | undefined;

function getSecretKey(): Uint8Array {
  if (cachedSecret) return cachedSecret;

  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET is not set — see .env.example");
  }
  cachedSecret = new TextEncoder().encode(secret);
  return cachedSecret;
}

export interface BackendTokenSubject {
  id: string;
  email: string;
  /** The session passed two-factor sign-in; becomes the `mfa` claim the backend's `TwoFactorGuard` checks. */
  twoFactor?: boolean;
}

/**
 * Signs a `{ sub, email }` HS256 JWT, valid for `TOKEN_TTL`, for calling the
 * backend as `Authorization: Bearer <token>`. Call this fresh for every
 * outgoing backend request (or cache briefly server-side) rather than
 * persisting it — its whole point is to be cheap to re-mint and expensive
 * to matter if leaked.
 */
export async function mintBackendToken(user: BackendTokenSubject): Promise<string> {
  return new SignJWT(user.twoFactor ? { email: user.email, mfa: true } : { email: user.email })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime(TOKEN_TTL)
    .sign(getSecretKey());
}
