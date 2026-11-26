import bcrypt from 'bcryptjs';
import { and, eq, gt } from 'drizzle-orm';
import { cookies } from 'next/headers';
import { hashSessionToken } from '@/auth';
import { db } from '@/lib/db';
import { sessions, users } from '@/lib/auth-schema';

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
