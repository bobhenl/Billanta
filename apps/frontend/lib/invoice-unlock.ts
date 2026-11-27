/**
 * Locked invoices (backend `src/invoices/invoice-lock.ts`) open for 15
 * minutes after the person re-enters their password. This cookie remembers
 * that, and `api-client` turns it into the `ul` claim of each backend JWT.
 *
 * The cookie is signed with a key derived from JWT_SECRET, never with
 * JWT_SECRET itself, so it can never pass as a backend token.
 *
 * The same cookie carries the step-up (backend `src/auth/step-up.ts`): when
 * the re-auth was a second factor (the TOTP code, or the password for an
 * account without 2FA) it says how, and its issue time becomes the `sa`
 * claim. The backend accepts that for a few minutes only.
 */
import { createHash } from 'node:crypto';
import { jwtVerify, SignJWT } from 'jose';
import { cookies } from 'next/headers';

const COOKIE = 'billanta_unlock';
const AUDIENCE = 'invoice-unlock';
export const UNLOCK_MINUTES = 15;

function key(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET is not set – see .env.example');
  return createHash('sha256').update(`invoice-unlock:${secret}`).digest();
}

/** How the person proved themselves: what the backend's step-up accepts. */
export type StepUpMethod = 'totp' | 'recovery' | 'password' | 'recent_sign_in' | 'passkey';
const METHODS: readonly StepUpMethod[] = ['totp', 'recovery', 'password', 'recent_sign_in', 'passkey'];

export interface Reauth {
  /** Re-authenticated within the last UNLOCK_MINUTES: locked invoices open. */
  unlocked: boolean;
  /** Set when that re-auth counts as a step-up. */
  stepUp?: { at: number; method: StepUpMethod };
}

/** What this browser's re-auth cookie says about `userId`. */
export async function reauthFor(userId: string): Promise<Reauth> {
  const raw = (await cookies()).get(COOKIE)?.value;
  if (!raw) return { unlocked: false };
  try {
    const { payload } = await jwtVerify(raw, key(), { algorithms: ['HS256'], audience: AUDIENCE });
    if (payload.sub !== userId) return { unlocked: false };
    const method = METHODS.find((m) => m === payload.sm);
    return { unlocked: true, ...(method && payload.iat ? { stepUp: { at: payload.iat, method } } : {}) };
  } catch {
    return { unlocked: false };
  }
}

/**
 * Call only after the password or code was checked (server actions only: it
 * sets a cookie). Pass `stepUp` when that check was a second factor.
 */
export async function grantUnlock(userId: string, stepUp?: StepUpMethod): Promise<void> {
  const token = await new SignJWT(stepUp ? { sm: stepUp } : {})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${UNLOCK_MINUTES}m`)
    .sign(key());
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    maxAge: UNLOCK_MINUTES * 60
  });
}

export async function revokeUnlock(): Promise<void> {
  (await cookies()).delete(COOKIE);
}
