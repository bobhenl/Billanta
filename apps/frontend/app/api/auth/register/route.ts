/**
 * Real signup endpoint backing `signup-form.tsx` (replaces its previous
 * `console.log`-only placeholder). Creates a `users` row with a bcrypt
 * password hash — never plaintext, never delegated to Auth.js's adapter
 * (which never reads/writes `password_hash`; see `lib/auth-schema.ts`) —
 * and, in the SAME transaction, bootstraps the user's first tenant via the
 * `bootstrap_tenant_for_user` SECURITY DEFINER function (see
 * `apps/backend/drizzle/rls-policies.sql`'s doc comment on that function for
 * the full safety reasoning). This closes the gap this file previously
 * documented: `TenantsService.signup()` remains a stub (it can't run before
 * a tenant context exists either, by construction — bootstrapping correctly
 * requires exactly this kind of one-shot SECURITY DEFINER escape hatch, not
 * a normal RLS-scoped service method), and `tos_acceptances` is now
 * genuinely recorded, not silently skipped.
 *
 * Wrapping both inserts in one `db.transaction` means a failure in the
 * bootstrap step (e.g. an empty company name reaching the DB despite
 * client-side validation) rolls back the user row too — never leaves a
 * login-capable user with no tenant behind it.
 */
import { eq, sql } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { ATTRIBUTION_COOKIE, signupAttributionColumns } from "@/lib/attribution";
import { clientIp } from "@/lib/client-ip";
import { db } from "@/lib/db";
import { AUTH_LIMITS, allow } from "@/lib/rate-limit";
import { users } from "@/lib/auth-schema";
import { trialDays } from "@/lib/plan";

const MIN_PASSWORD_LENGTH = 8;
const BCRYPT_COST_FACTOR = 12;

export async function POST(request: Request): Promise<NextResponse> {
  const ip = clientIp(request);
  if (ip && !allow(`register:ip:${ip}`, AUTH_LIMITS.registerPerIp)) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }
  const body = await request.json().catch(() => null);

  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : undefined;
  const password = typeof body?.password === "string" ? body.password : undefined;
  const companyName = typeof body?.companyName === "string" ? body.companyName.trim() : undefined;
  const tosVersionAccepted = typeof body?.tosVersionAccepted === "string" ? body.tosVersionAccepted : undefined;
  // The signup checkbox confirms the user is 18+ and acts as a business;
  // the service is not for children (COPPA / GDPR art. 8) or consumers.
  const adultConfirmed = body?.adultConfirmed === true;

  if (
    !email ||
    !email.includes("@") ||
    !password ||
    password.length < MIN_PASSWORD_LENGTH ||
    !companyName ||
    !tosVersionAccepted ||
    !adultConfirmed
  ) {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }

  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (existing) {
    return NextResponse.json({ error: "email_taken" }, { status: 409 });
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_COST_FACTOR);

  // Best-effort only, per this app's other request-handling conventions —
  // not load-bearing for auth/authorization, just an audit-trail field.
  const ipAddress =
    clientIp(request) || null;

  // Where the visitor first came from (middleware.ts), for signups per source.
  const attribution = signupAttributionColumns((await cookies()).get(ATTRIBUTION_COOKIE)?.value);

  try {
    const { tenantId, userId } = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(users)
        .values({ email, passwordHash, ...attribution })
        .returning({ id: users.id, email: users.email });

      if (!created) {
        throw new Error("user insert returned no row");
      }

      const [bootstrapped] = await tx.execute<{ tenant_id: string }>(
        sql`SELECT bootstrap_tenant_for_user(${created.id}, ${companyName}, ${tosVersionAccepted}, ${ipAddress}, ${trialDays()}) AS tenant_id`,
      );

      if (!bootstrapped?.tenant_id) {
        throw new Error("bootstrap_tenant_for_user returned no tenant id");
      }

      return { tenantId: bootstrapped.tenant_id, userId: created.id };
    });

    return NextResponse.json({ id: userId, email, tenantId }, { status: 201 });
  } catch (error) {
    console.error("Signup failed", error);
    return NextResponse.json({ error: "signup_failed" }, { status: 500 });
  }
}
