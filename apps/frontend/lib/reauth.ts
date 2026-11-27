import bcrypt from 'bcryptjs';
import { and, eq, gt } from 'drizzle-orm';
import { cookies } from 'next/headers';
import { hashSessionToken } from '@/auth';
import { db } from '@/lib/db';
import { sessions, users } from '@/lib/auth-schema';
import type { StepUpMethod } from '@/lib/invoice-unlock';
import { verifyTwoFactorCode } from '@/lib/two-factor';

/**
 * An account without a password has nothing to re-enter before a sensitive
 * step, so it needs a sign-in from the last few minutes instead. Otherwise
 * a stolen session cookie could set a password, move the email to the thief's
 * inbox, delete the account or open a locked invoice.
 */
const REAUTH_WINDOW_MS = 10 * 60 * 1000;

export async function signedInRecently(userId: string): Promise<boolean> {
  const jar = await cookies();
  const raw = jar.get('__Secure-authjs.session-token')?.value ?? jar.get('authjs.session-token')?.value;
  if (!raw) return false;
  const [fresh] = await db
    .select({ userId: sessions.userId })
    .from(sessions)
    .where(and(eq(sessions.sessionToken, hashSessionToken(raw)), eq(sessions.userId, userId), gt(sessions.createdAt, new Date(Date.now() - REAUTH_WINDOW_MS))))
    .limit(1);
  return Boolean(fresh);
}

/** Re-checks the local password (if the account has one) before a sensitive step. */
export async function verifyPassword(userId: string, password: string): Promise<{ email: string } | 'wrong_current' | 'reauth_required' | null> {
  const [user] = await db.select({ email: users.email, passwordHash: users.passwordHash }).from(users).where(eq(users.id, userId)).limit(1);
  if (!user) return null;
  if (user.passwordHash && !(await bcrypt.compare(password, user.passwordHash))) return 'wrong_current';
  if (!user.passwordHash && !(await signedInRecently(userId))) return 'reauth_required';
  return { email: user.email };
}

/** What a step-up asks this person for: the TOTP code, the password, or (no password, no 2FA) a fresh sign-in. */
export type StepUpKind = 'totp' | 'password' | 'sign_in';

export async function stepUpKind(userId: string): Promise<StepUpKind | null> {
  const [user] = await db
    .select({ passwordHash: users.passwordHash, totpEnabledAt: users.totpEnabledAt })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!user) return null;
  if (user.totpEnabledAt) return 'totp';
  return user.passwordHash ? 'password' : 'sign_in';
}

/**
 * The step-up check (backend `src/auth/step-up.ts`). With two-factor sign-in
 * on only a code counts (TOTP or a recovery code), so the login password
 * alone opens nothing. Without it: the password, or for an account that has
 * none, a sign-in from the last few minutes.
 */
export async function verifyStepUp(userId: string, secret: string): Promise<StepUpMethod | 'invalid_code' | 'wrong_current' | 'reauth_required' | null> {
  const kind = await stepUpKind(userId);
  if (!kind) return null;
  if (kind === 'totp') return (await verifyTwoFactorCode(userId, secret.trim())) ?? 'invalid_code';
  const me = await verifyPassword(userId, secret);
  if (!me || me === 'wrong_current' || me === 'reauth_required') return me;
  return kind === 'password' ? 'password' : 'recent_sign_in';
}
