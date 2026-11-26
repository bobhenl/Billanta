/**
 * Locked invoices (backend `src/invoices/invoice-lock.ts`) open for 15
 * minutes after the person re-enters their password. This cookie remembers
 * that, and `api-client` turns it into the `ul` claim of each backend JWT.
 *
 * The cookie is signed with a key derived from JWT_SECRET, never with
 * JWT_SECRET itself, so it can never pass as a backend token.
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

/** Whether this browser re-authenticated `userId` within the last UNLOCK_MINUTES. */
export async function unlockedFor(userId: string): Promise<boolean> {
  const raw = (await cookies()).get(COOKIE)?.value;
  if (!raw) return false;
  try {
    const { payload } = await jwtVerify(raw, key(), { algorithms: ['HS256'], audience: AUDIENCE });
    return payload.sub === userId;
  } catch {
    return false;
  }
}

/** Call only after the password was checked (server actions only: it sets a cookie). */
export async function grantUnlock(userId: string): Promise<void> {
  const token = await new SignJWT({})
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
