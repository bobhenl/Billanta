/**
 * `POST /api/auth/reset-password` — second half of the forgot/reset password
 * flow (see `app/api/auth/forgot-password/route.ts`'s doc comment for the
 * full anti-enumeration/single-use-token reasoning this endpoint shares).
 *
 * Accepts `{ token, password }` where `token` is the RAW token from the
 * emailed link. Only the SHA-256 hash of `token` is ever compared against
 * the stored `verification_tokens.token` column — a DB read alone can never
 * be replayed as a valid reset token.
 *
 * Deliberately does NOT distinguish "token not found" from "token expired"
 * in the response (same generic-error anti-enumeration reasoning as
 * forgot-password's generic success response) — either way the caller just
 * needs to know the link no longer works and to request a new one.
 *
 * Single-use: the token row is deleted immediately after a successful
 * password update, in the same transaction as the `users.password_hash`
 * write, so a replayed request with the same token can never succeed twice.
 */
import { createHash } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { and, eq, gt } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { clientIp } from '@/lib/client-ip';
import { db } from '@/lib/db';
import { AUTH_LIMITS, allow } from '@/lib/rate-limit';
import { sessions, users, verificationTokens } from '@/lib/auth-schema';

// Same rule as `app/api/auth/register/route.ts`'s `MIN_PASSWORD_LENGTH` —
// duplicated rather than imported since that route doesn't export it; keep
// both in sync if the minimum ever changes.
const MIN_PASSWORD_LENGTH = 8;
const BCRYPT_COST_FACTOR = 12;

const INVALID_TOKEN_RESPONSE = () =>
  NextResponse.json({ error: 'invalid_or_expired_token' }, { status: 400 });

export async function POST(request: Request): Promise<NextResponse> {
  const ip = clientIp(request);
  if (ip && !allow(`reset:ip:${ip}`, AUTH_LIMITS.resetPerIp)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }
  const body = await request.json().catch(() => null);
  const token = typeof body?.token === 'string' ? body.token : undefined;
  const password = typeof body?.password === 'string' ? body.password : undefined;

  if (!token) {
    return INVALID_TOKEN_RESPONSE();
  }

  if (!password || password.length < MIN_PASSWORD_LENGTH) {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }

  const hashedToken = createHash('sha256').update(token, 'utf8').digest('hex');

  try {
    const [tokenRow] = await db
      .select({ identifier: verificationTokens.identifier })
      .from(verificationTokens)
      .where(and(eq(verificationTokens.token, hashedToken), gt(verificationTokens.expires, new Date())))
      .limit(1);

    if (!tokenRow) {
      return INVALID_TOKEN_RESPONSE();
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_COST_FACTOR);

    await db.transaction(async (tx) => {
      await tx.update(users).set({ passwordHash, updatedAt: new Date() }).where(eq(users.email, tokenRow.identifier));

      // A reset means the old password may be known to someone else: end
      // every existing session of this account, on all devices.
      const [user] = await tx.select({ id: users.id }).from(users).where(eq(users.email, tokenRow.identifier)).limit(1);
      if (user) await tx.delete(sessions).where(eq(sessions.userId, user.id));

      // Delete by (identifier, token) — the composite primary key — not just
      // by token, so this stays correct even though `token` alone is also
      // effectively unique in practice.
      await tx
        .delete(verificationTokens)
        .where(and(eq(verificationTokens.identifier, tokenRow.identifier), eq(verificationTokens.token, hashedToken)));
    });

    return NextResponse.json({ message: 'Password updated.' });
  } catch (error) {
    console.error('reset-password request failed', error);
    return NextResponse.json({ error: 'reset_failed' }, { status: 500 });
  }
}
