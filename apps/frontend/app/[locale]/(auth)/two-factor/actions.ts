'use server';

import { auth, signOut } from '@/auth';
import { AUTH_LIMITS, allow, resetTokens } from '@/lib/rate-limit';
import { markCurrentSessionVerified, verifyTwoFactorCode } from '@/lib/two-factor';

export type TwoFactorResult = { ok: true; usedRecovery: boolean } | { ok: false; error: 'invalid_code' | 'rate_limited' | 'not_signed_in' };

/** Second step of sign-in: a code from the authenticator app or a recovery code unlocks this session. */
export async function submitTwoFactorCode(code: string): Promise<TwoFactorResult> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: 'not_signed_in' };
  if (session.twoFactor !== 'pending') return { ok: true, usedRecovery: false };

  const key = `2fa:user:${userId}`;
  if (!allow(key, AUTH_LIMITS.twoFactorPerUser)) return { ok: false, error: 'rate_limited' };

  const method = await verifyTwoFactorCode(userId, code);
  if (!method) return { ok: false, error: 'invalid_code' };
  resetTokens(key);
  if (!(await markCurrentSessionVerified(userId))) return { ok: false, error: 'not_signed_in' };
  return { ok: true, usedRecovery: method === 'recovery' };
}

/** "Not you / no phone at hand": drop the half-signed-in session. */
export async function cancelTwoFactor(): Promise<void> {
  await signOut({ redirect: false });
}
