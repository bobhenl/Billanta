/**
 * Server-side helper for Server Components / Route Handlers to call the
 * NestJS backend as the currently signed-in dashboard user.
 *
 * ============================================================================
 * THE MISSING PIECE THIS FILE SOLVES: how does the frontend know which
 * tenant to act as?
 * ============================================================================
 * `TenantContextMiddleware` (apps/backend/src/tenancy/tenant-context.
 * middleware.ts) requires a REQUIRED `X-Tenant-Id` header on every
 * tenant-scoped request and verifies the caller actually belongs to that
 * tenant via `tenant_memberships` — but nothing on the frontend has ever
 * determined what that id even IS. A user's tenant membership lives in
 * `tenant_memberships`, a backend-owned table; the frontend's own DB access
 * (`lib/db.ts`) is scoped to the Auth.js-adapter tables only (`users`/
 * `accounts`/`sessions`/`verification_tokens`) and can never see it.
 *
 * The fix: `GET /api/v1/me` (`apps/backend/src/me/`) is a JWT-only endpoint
 * (no `X-Tenant-Id` required — that's the whole point, see its doc comment)
 * that returns every tenant the verified JWT's user belongs to. This module
 * calls it once per request (via React's `cache()`, so multiple Server
 * Components rendering the same request don't each re-call `/me`), then
 * picks the active tenant for every subsequent `apiFetch` call in that
 * request.
 *
 * ACTIVE COMPANY: a user can belong to several companies (their own ones
 * created via `POST /api/v1/me/tenants`, plus invitations). The chosen one
 * is kept in the `billanta_tenant` cookie (`ACTIVE_TENANT_COOKIE`, set by
 * the `switchTenant` server action in `lib/tenant-actions.ts`). The cookie
 * only picks among memberships `/me` returned — an id the user doesn't
 * belong to is ignored, and the backend re-checks membership anyway. Without
 * a (valid) cookie the oldest membership is used (`/me` is ordered by
 * membership `created_at`, migration 0032).
 */
import { cache } from "react";
import { cookies } from "next/headers";
import { auth } from "@/auth";
import { mintBackendToken } from "./backend-token";

// Same var `lib/public-invoices.ts` already uses for its own server-side
// backend fetch — reused as-is, not duplicated (see .env.example's
// "Frontend -> backend server-side integration" section).
const BACKEND_URL = (process.env.BACKEND_URL ?? "http://localhost:3000").replace(/\/$/, "");

/** Cookie holding the active company id (see the top-of-file comment). */
export const ACTIVE_TENANT_COOKIE = "billanta_tenant";

export interface CurrentTenant {
  id: string;
  companyName: string;
  role: string;
}

export interface MeResponse {
  userId: string;
  email: string;
  tenants: CurrentTenant[];
}

/** Thrown when `apiFetch` (or `resolveIdentity`) is called with no active
 * NextAuth session — callers should catch this and redirect to `/login`. */
export class NotSignedInError extends Error {
  constructor() {
    super("No active session — sign in required before calling the backend API");
    this.name = "NotSignedInError";
  }
}

/** Thrown when the signed-in user has zero tenant memberships (see
 * `MeController`'s doc comment — shouldn't happen given the signup
 * bootstrap flow, but possible for a user created before that existed, or
 * some other edge case). Callers should catch this and show a distinct
 * "no workspace yet" state rather than crashing. */
export class NoTenantError extends Error {
  constructor(userId: string) {
    super(`User ${userId} has no tenant memberships`);
    this.name = "NoTenantError";
  }
}

/** Thrown for any non-2xx response from the backend, including a non-2xx
 * response from `GET /api/v1/me` itself. Carries the HTTP status and raw
 * response body so callers/logs have enough to debug without re-fetching. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly path: string,
    public readonly body: string,
  ) {
    super(`Backend request to ${path} failed with ${status}: ${body || "(empty body)"}`);
    this.name = "ApiError";
  }
}

interface ResolvedIdentity {
  token: string;
  tenantId: string;
  me: MeResponse;
}

/**
 * Mints a backend JWT for the current session and resolves the active
 * tenant id via `GET /api/v1/me`, once per request — React's `cache()`
 * dedupes concurrent/repeated calls within the same render pass (it does
 * NOT persist across requests, which is correct here: the backend JWT is
 * deliberately short-lived, see `backend-token.ts`).
 */
const resolveIdentity = cache(async (): Promise<ResolvedIdentity> => {
  const session = await auth();
  // A session still waiting for its two-factor code counts as signed out here.
  if (!session?.user?.id || !session.user.email || session.twoFactor === "pending") {
    throw new NotSignedInError();
  }

  const token = await mintBackendToken({
    id: session.user.id,
    email: session.user.email,
    twoFactor: session.twoFactor === "verified",
  });

  const res = await fetch(`${BACKEND_URL}/api/v1/me`, {
    headers: { Authorization: `Bearer ${token}` },
    // Tenant membership can change between requests (a teammate is added/
    // removed) — never serve this from a cache.
    cache: "no-store",
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new ApiError(res.status, "/api/v1/me", body);
  }

  const me = (await res.json()) as MeResponse;
  const active = pickActiveTenant(me.tenants, (await cookies()).get(ACTIVE_TENANT_COOKIE)?.value);
  if (!active) {
    throw new NoTenantError(me.userId);
  }

  return { token, tenantId: active.id, me };
});

/** The cookie's company if the user belongs to it, else the oldest membership. */
export function pickActiveTenant(tenants: CurrentTenant[], cookieValue: string | undefined): CurrentTenant | null {
  return tenants.find((t) => t.id === cookieValue) ?? tenants[0] ?? null;
}

/** Every company of the signed-in user plus the active one (same choice as `apiFetch`). */
export async function fetchMyCompanies(): Promise<{ tenants: CurrentTenant[]; active: CurrentTenant }> {
  const { me, tenantId } = await resolveIdentity();
  const active = me.tenants.find((t) => t.id === tenantId)!;
  return { tenants: me.tenants, active };
}

/**
 * Fetches `${BACKEND_URL}${path}` as the current dashboard user, attaching
 * both `Authorization: Bearer <backend JWT>` and the resolved
 * `X-Tenant-Id` header `TenantContextMiddleware` requires. Throws
 * `NotSignedInError`/`NoTenantError` for the two "can't even resolve an
 * identity" cases (see above), or `ApiError` for any other non-2xx
 * response — callers decide how to render each.
 */
export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const { token, tenantId } = await resolveIdentity();

  const res = await fetch(`${BACKEND_URL}${path}`, {
    ...init,
    headers: {
      ...init?.headers,
      Authorization: `Bearer ${token}`,
      "X-Tenant-Id": tenantId,
    },
    // Tenant-scoped data (invoices, contacts, ...) is per-request,
    // per-tenant business data — never serve it from Next's fetch cache
    // unless a specific caller has a good reason to override this.
    cache: init?.cache ?? "no-store",
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new ApiError(res.status, path, body);
  }

  // 204 No Content etc. — nothing to parse.
  if (res.status === 204) {
    return undefined as T;
  }

  return (await res.json()) as T;
}

/**
 * Like `apiFetch`, but hands back the raw `Response` (non-2xx still throws)
 * — for binary downloads (PDF, ISDOC, CSV/XML exports) that a Route Handler
 * streams straight through to the browser.
 */
export async function apiFetchRaw(path: string, init?: RequestInit): Promise<Response> {
  const { token, tenantId } = await resolveIdentity();
  const res = await fetch(`${BACKEND_URL}${path}`, {
    ...init,
    headers: { ...init?.headers, Authorization: `Bearer ${token}`, "X-Tenant-Id": tenantId },
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new ApiError(res.status, path, body);
  }
  return res;
}

/**
 * Calls a backend endpoint that answers with a redirect (e.g. an OAuth
 * `authorize` route) and returns its `Location` instead of following it —
 * a browser navigation can't carry the bearer JWT, so a Route Handler asks
 * on its behalf and then redirects the browser itself.
 */
export async function apiRedirectLocation(path: string): Promise<string> {
  const { token, tenantId } = await resolveIdentity();
  const res = await fetch(`${BACKEND_URL}${path}`, {
    headers: { Authorization: `Bearer ${token}`, "X-Tenant-Id": tenantId },
    cache: "no-store",
    redirect: "manual",
  });
  const location = res.headers.get("location");
  if (res.status < 300 || res.status >= 400 || !location) {
    const body = await res.text().catch(() => "");
    throw new ApiError(res.status, path, body);
  }
  return location;
}
