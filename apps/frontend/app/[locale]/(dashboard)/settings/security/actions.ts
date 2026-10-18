'use server';

import { eq } from 'drizzle-orm';
import QRCode from 'qrcode';
import { revalidatePath } from 'next/cache';
import { auth } from '@/auth';
import { users } from '@/lib/auth-schema';
import { db } from '@/lib/db';
import { AUTH_LIMITS, allow, resetTokens } from '@/lib/rate-limit';
import { SITE_NAME } from '@/lib/site';
import { generateTotpSecret, otpauthUri } from '@/lib/totp';
import {
  deleteOtherSessions,
  encryptTotpSecret,
  generateRecoveryCodes,
  markCurrentSessionVerified,
  twoFactorState,
  verifyTwoFactorCode
} from '@/lib/two-factor';

type Fail = { ok: false; error: 'not_signed_in' | 'already_enabled' | 'not_enabled' | 'invalid_code' | 'rate_limited' | 'demo_disabled' };
export type SetupResult = { ok: true; secret: string; qr: string } | Fail;
export type CodesResult = { ok: true; codes: string[] } | Fail;
export type PlainResult = { ok: true } | Fail;

async function signedInUser(): Promise<{ id: string; email: string } | null> {
  const session = await auth();
  if (!session?.user?.id || !session.user.email || session.twoFactor === 'pending') return null;
  return { id: session.user.id, email: session.user.email };
}

/** Shared with the sign-in step, so the code prompts here are no side door for guessing. */
function underLimit(userId: string): boolean {
  return allow(`2fa:user:${userId}`, AUTH_LIMITS.twoFactorPerUser);
}

/** New secret (replacing an unconfirmed one) and its QR code; nothing is switched on until `confirmTwoFactorSetup`. */
export async function startTwoFactorSetup(): Promise<SetupResult> {
  // A throwaway demo user (deleted after 24 h) has nothing to protect.
  if ((await auth())?.isDemo) return { ok: false, error: 'demo_disabled' };
  const user = await signedInUser();
  if (!user) return { ok: false, error: 'not_signed_in' };
  if ((await twoFactorState(user.id)).enabled) return { ok: false, error: 'already_enabled' };

  const secret = generateTotpSecret();
  await db
    .update(users)
    .set({ totpSecret: encryptTotpSecret(secret), totpEnabledAt: null, totpRecoveryCodes: null, totpLastStep: null })
    .where(eq(users.id, user.id));
  const qr = await QRCode.toDataURL(otpauthUri(secret, user.email, SITE_NAME), { margin: 1, width: 220 });
  return { ok: true, secret, qr };
}

/**
 * The first correct code switches 2FA on and returns the recovery codes
 * (shown once). Other devices are signed out: they never passed a code.
 */
export async function confirmTwoFactorSetup(code: string): Promise<CodesResult> {
  if ((await auth())?.isDemo) return { ok: false, error: 'demo_disabled' };
  const user = await signedInUser();
  if (!user) return { ok: false, error: 'not_signed_in' };
  if (!underLimit(user.id)) return { ok: false, error: 'rate_limited' };
  if (!(await verifyTwoFactorCode(user.id, code, { pendingSetup: true }))) return { ok: false, error: 'invalid_code' };
  resetTokens(`2fa:user:${user.id}`);

  const { codes, hashes } = generateRecoveryCodes();
  await db.update(users).set({ totpEnabledAt: new Date(), totpRecoveryCodes: hashes }).where(eq(users.id, user.id));
  await markCurrentSessionVerified(user.id);
  await deleteOtherSessions(user.id);
  revalidatePath('/', 'layout');
  return { ok: true, codes };
}

/** Switching off asks for a current code (or a recovery code), so a borrowed unlocked laptop is not enough. */
export async function disableTwoFactor(code: string): Promise<PlainResult> {
  const user = await signedInUser();
  if (!user) return { ok: false, error: 'not_signed_in' };
  if (!(await twoFactorState(user.id)).enabled) return { ok: false, error: 'not_enabled' };
  if (!underLimit(user.id)) return { ok: false, error: 'rate_limited' };
  if (!(await verifyTwoFactorCode(user.id, code))) return { ok: false, error: 'invalid_code' };

  await db
    .update(users)
    .set({ totpSecret: null, totpEnabledAt: null, totpRecoveryCodes: null, totpLastStep: null })
    .where(eq(users.id, user.id));
  revalidatePath('/', 'layout');
  return { ok: true };
}

/** Replaces every recovery code; needs a code from the app, not a recovery code. */
export async function regenerateRecoveryCodes(code: string): Promise<CodesResult> {
  const user = await signedInUser();
  if (!user) return { ok: false, error: 'not_signed_in' };
  if (!(await twoFactorState(user.id)).enabled) return { ok: false, error: 'not_enabled' };
  if (!underLimit(user.id)) return { ok: false, error: 'rate_limited' };
  if (!(await verifyTwoFactorCode(user.id, code, { allowRecovery: false }))) return { ok: false, error: 'invalid_code' };

  const { codes, hashes } = generateRecoveryCodes();
  await db.update(users).set({ totpRecoveryCodes: hashes }).where(eq(users.id, user.id));
  revalidatePath('/settings/security');
  return { ok: true, codes };
}
