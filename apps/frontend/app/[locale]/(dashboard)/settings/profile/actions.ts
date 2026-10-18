'use server';

import { createHash, randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { and, eq, like, lt, ne } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { auth, hashSessionToken, signOut } from '@/auth';
import { mintBackendToken } from '@/lib/backend-token';
import { db } from '@/lib/db';
import { sessions, users, verificationTokens } from '@/lib/auth-schema';
import { sendEmailChangeEmail } from '@/lib/email';
import { SITE_URL } from '@/lib/site';

export type ProfileResult = { ok: true } | { ok: false; error: string; company?: string };

// Same rules as `app/api/auth/register` and `reset-password`.
const MIN_PASSWORD_LENGTH = 8;
const BCRYPT_COST_FACTOR = 12;

async function currentUserId(): Promise<string | null> {
  const session = await auth();
  if (session?.twoFactor === 'pending') return null;
  return session?.user?.id ?? null;
}

/**
 * A demo user has no password and is deleted with its company, so it gets no
 * password, email or account changes: a password would let someone keep the
 * throwaway account, and deleting it here would skip the demo cleanup.
 */
async function refuseDemo(): Promise<ProfileResult | null> {
  return (await auth())?.isDemo ? { ok: false, error: 'demo_disabled' } : null;
}

export async function updateProfileName(name: string): Promise<ProfileResult> {
  const userId = await currentUserId();
  if (!userId) return { ok: false, error: 'not_signed_in' };
  const trimmed = name.trim();
  if (trimmed.length > 120) return { ok: false, error: 'name_too_long' };
  await db.update(users).set({ name: trimmed || null, updatedAt: new Date() }).where(eq(users.id, userId));
  revalidatePath('/', 'layout');
  return { ok: true };
}

/** Changes the local password; `current` is required only when one is already set (OAuth-only users set their first one). */
export async function changePassword(current: string, next: string): Promise<ProfileResult> {
  const refused = await refuseDemo();
  if (refused) return refused;
  const userId = await currentUserId();
  if (!userId) return { ok: false, error: 'not_signed_in' };
  if (next.length < MIN_PASSWORD_LENGTH) return { ok: false, error: 'too_short' };

  const [user] = await db.select({ passwordHash: users.passwordHash }).from(users).where(eq(users.id, userId)).limit(1);
  if (!user) return { ok: false, error: 'not_signed_in' };
  if (user.passwordHash && !(await bcrypt.compare(current, user.passwordHash))) {
    return { ok: false, error: 'wrong_current' };
  }

  const passwordHash = await bcrypt.hash(next, BCRYPT_COST_FACTOR);
  await db.update(users).set({ passwordHash, updatedAt: new Date() }).where(eq(users.id, userId));

  // Sign out every other device: whoever knew the old password may already
  // hold a session. This browser stays signed in.
  const jar = await cookies();
  const thisSession = jar.get('__Secure-authjs.session-token')?.value ?? jar.get('authjs.session-token')?.value;
  await db
    .delete(sessions)
    .where(thisSession ? and(eq(sessions.userId, userId), ne(sessions.sessionToken, hashSessionToken(thisSession))) : eq(sessions.userId, userId));
  return { ok: true };
}

const BACKEND_URL = (process.env.BACKEND_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const EMAIL_CHANGE_TTL_MS = 60 * 60 * 1000; // 1 hour, same as password reset
const EMAIL_CHANGE_PREFIX = 'email-change:';

/** Re-checks the local password (if the account has one) before a sensitive change. */
async function verifyPassword(userId: string, password: string): Promise<{ email: string } | 'wrong_current' | null> {
  const [user] = await db.select({ email: users.email, passwordHash: users.passwordHash }).from(users).where(eq(users.id, userId)).limit(1);
  if (!user) return null;
  if (user.passwordHash && !(await bcrypt.compare(password, user.passwordHash))) return 'wrong_current';
  return { email: user.email };
}

/**
 * Change of sign-in email (idea from faktorio, MIT © Jiri Spac): sends a
 * one-hour confirmation link to the NEW address; nothing changes until it is
 * opened (`app/api/auth/confirm-email`). The pending change lives in
 * `verification_tokens` as `email-change:<userId>:<newEmail>` + SHA-256 of
 * the token — the same storage the password-reset flow uses.
 */
export async function requestEmailChange(password: string, newEmailRaw: string, locale: string): Promise<ProfileResult> {
  const refused = await refuseDemo();
  if (refused) return refused;
  const userId = await currentUserId();
  if (!userId) return { ok: false, error: 'not_signed_in' };
  const newEmail = newEmailRaw.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail) || newEmail.length > 320) return { ok: false, error: 'invalid_email' };

  const me = await verifyPassword(userId, password);
  if (!me) return { ok: false, error: 'not_signed_in' };
  if (me === 'wrong_current') return { ok: false, error: 'wrong_current' };
  if (me.email === newEmail) return { ok: false, error: 'same_email' };
  const [taken] = await db.select({ id: users.id }).from(users).where(eq(users.email, newEmail)).limit(1);
  if (taken) return { ok: false, error: 'email_taken' };

  await db.delete(verificationTokens).where(lt(verificationTokens.expires, new Date()));
  // Only the latest pending change per user is valid.
  await db.delete(verificationTokens).where(like(verificationTokens.identifier, `${EMAIL_CHANGE_PREFIX}${userId}:%`));
  const rawToken = randomBytes(32).toString('base64url');
  await db.insert(verificationTokens).values({
    identifier: `${EMAIL_CHANGE_PREFIX}${userId}:${newEmail}`,
    token: createHash('sha256').update(rawToken, 'utf8').digest('hex'),
    expires: new Date(Date.now() + EMAIL_CHANGE_TTL_MS)
  });

  const lang = ['cs', 'sk', 'en'].includes(locale) ? locale : 'cs';
  const confirmUrl = `${SITE_URL}/api/auth/confirm-email?token=${rawToken}&locale=${lang}`;
  try {
    await sendEmailChangeEmail({ to: newEmail, confirmUrl, userId, validMinutes: EMAIL_CHANGE_TTL_MS / 60_000 });
  } catch (error) {
    console.error('Failed to queue email change confirmation', error);
    await db.delete(verificationTokens).where(like(verificationTokens.identifier, `${EMAIL_CHANGE_PREFIX}${userId}:%`));
    return { ok: false, error: 'send_failed' };
  }
  if (process.env.NODE_ENV !== 'production') {
    // Local dev usually has no Resend key, so the queued mail never leaves:
    // print the link so the flow stays testable.
    console.info(`[dev] email change confirmation link for ${newEmail}: ${confirmUrl}`);
  }
  return { ok: true };
}

/**
 * Permanent account deletion (idea from faktorio, MIT © Jiri Spac). The
 * backend first wipes every company where this user is the only member and
 * leaves the shared ones (refusing with `last_admin` / `issued_in_shared`
 * before touching anything); then the Auth.js user row goes, cascading its
 * OAuth accounts and sessions.
 */
export async function deleteAccount(password: string, confirmEmail: string): Promise<ProfileResult> {
  const refused = await refuseDemo();
  if (refused) return refused;
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId || !session.user?.email || session.twoFactor === 'pending') return { ok: false, error: 'not_signed_in' };

  const me = await verifyPassword(userId, password);
  if (!me) return { ok: false, error: 'not_signed_in' };
  if (me === 'wrong_current') return { ok: false, error: 'wrong_current' };
  if (confirmEmail.trim().toLowerCase() !== me.email.toLowerCase()) return { ok: false, error: 'confirm_mismatch' };

  const token = await mintBackendToken({ id: userId, email: me.email });
  const res = await fetch(`${BACKEND_URL}/api/v1/me`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store'
  });
  if (res.status === 409) {
    const body = (await res.json().catch(() => ({}))) as { error?: string; company?: string };
    return { ok: false, error: body.error === 'issued_in_shared' ? 'issued_in_shared' : 'last_admin', company: body.company ?? '' };
  }
  if (!res.ok) return { ok: false, error: 'delete_failed' };

  await db.delete(verificationTokens).where(like(verificationTokens.identifier, `${EMAIL_CHANGE_PREFIX}${userId}:%`));
  await db.delete(verificationTokens).where(eq(verificationTokens.identifier, me.email));
  try {
    await signOut({ redirect: false });
  } catch {
    // The session row is removed by the cascade below anyway.
  }
  await db.delete(users).where(eq(users.id, userId));
  return { ok: true };
}
