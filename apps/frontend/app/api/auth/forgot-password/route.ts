/**
 * `POST /api/auth/forgot-password` — first half of the forgot/reset password
 * flow (the missing piece of the auth story now that email/password
 * registration and Google/Discord OAuth both work — see
 * `app/api/auth/register/route.ts` for the sibling endpoint this mirrors).
 *
 * Reuses the existing Auth.js-adapter `verification_tokens` table
 * (`lib/auth-schema.ts`) rather than adding a new one — that table's whole
 * purpose is exactly this "prove you control this email address" flow;
 * Auth.js's own passwordless/email-verification flows use it the same way.
 *
 * ============================================================================
 * ANTI-ENUMERATION — read before changing this route's response shape.
 * ============================================================================
 * This endpoint ALWAYS returns the same 200 + generic body, whether or not
 * `email` belongs to a real account, and whether or not that account has a
 * local password (an OAuth-only user has nothing to reset). Never branch the
 * HTTP status, response body, or (as much as this runtime allows) timing on
 * "does this email exist" — that would let an attacker enumerate registered
 * emails one guess at a time. The only difference between "no such user",
 * "user has no password", and "user exists and got an email" is: whether an
 * email was actually sent, which is unobservable to the caller.
 *
 * SINGLE-USE / short-lived token: a fresh cryptographically-random token is
 * generated per request (`crypto.randomBytes`, not `Math.random()`); only
 * its SHA-256 hash is stored (mirrors `api_keys.key_hash`'s "never store the
 * raw secret" standard — see `apps/backend/src/api-keys/api-key.util.ts`'s
 * doc comment for why SHA-256, not bcrypt, is the right choice for a
 * high-entropy machine-generated secret like this one). Expiry is 1 hour.
 * Any pre-existing reset tokens for this identifier are deleted first, so a
 * user who requests multiple resets only ever has the most recent link
 * valid — and expired rows are opportunistically swept on every call.
 */
import { randomBytes, createHash } from 'node:crypto';
import { eq, lt } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { users, verificationTokens } from '@/lib/auth-schema';
import { sendPasswordResetEmail } from '@/lib/email';
import { SITE_URL } from '@/lib/site';

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

// Always the same body/status regardless of whether the email exists or has
// a password — see this file's top doc comment. A fresh `NextResponse` is
// constructed per call (never a shared/module-level instance) since a
// `Response` body can only be consumed once.
function genericResponse(): NextResponse {
  return NextResponse.json({
    message: 'If an account exists for this email, we’ve sent a password reset link.'
  });
}

export async function POST(request: Request): Promise<NextResponse> {
  const body = await request.json().catch(() => null);
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : undefined;
  // `locale` is optional, best-effort — only used to build a locale-prefixed
  // reset link; falls back to the default locale if missing/invalid.
  const locale = typeof body?.locale === 'string' && ['cs', 'sk', 'en'].includes(body.locale) ? body.locale : 'cs';

  if (!email || !email.includes('@')) {
    // Still generic: malformed input gets the same response shape, just
    // skips the DB round-trip. This does NOT leak anything an attacker
    // couldn't already tell from the input they typed themselves.
    return genericResponse();
  }

  try {
    // Opportunistic cleanup of expired tokens (any identifier) — this table
    // is shared with Auth.js's own flows, so only ever delete by expiry, not
    // by identifier alone.
    await db.delete(verificationTokens).where(lt(verificationTokens.expires, new Date()));

    const [user] = await db
      .select({ id: users.id, passwordHash: users.passwordHash })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    // No user, or an OAuth-only user with no local password to reset —
    // silently do nothing and fall through to the generic response.
    if (user?.passwordHash) {
      // Invalidate any previous outstanding reset token for this email
      // before issuing a new one, so only the latest link works.
      await db.delete(verificationTokens).where(eq(verificationTokens.identifier, email));

      const rawToken = randomBytes(32).toString('base64url');
      const hashedToken = createHash('sha256').update(rawToken, 'utf8').digest('hex');
      const expires = new Date(Date.now() + RESET_TOKEN_TTL_MS);

      await db.insert(verificationTokens).values({ identifier: email, token: hashedToken, expires });

      const resetUrl = `${SITE_URL}/${locale}/reset-password?token=${rawToken}`;

      try {
        await sendPasswordResetEmail({ to: email, resetUrl });
      } catch (emailError) {
        // Log and swallow: a failed send must not turn into a distinguishable
        // response (and must not fail the request in a way that reveals the
        // token was created). The user just won't receive the email.
        console.error('Failed to send password reset email', emailError);
      }
    }
  } catch (error) {
    // Same reasoning — never surface a different response for a DB error
    // than for "no such user". Log server-side only.
    console.error('forgot-password request failed', error);
  }

  return genericResponse();
}
