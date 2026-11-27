'use server';

import { auth } from '@/auth';
import { grantUnlock } from '@/lib/invoice-unlock';
import { allow } from '@/lib/rate-limit';
import { stepUpKind, verifyStepUp, type StepUpKind } from '@/lib/reauth';

/**
 * Server side of the step-up dialog (`components/step-up.tsx`). A success
 * writes the re-auth cookie (`lib/invoice-unlock.ts`), so the next backend
 * call carries the proof; the backend decides whether it is fresh enough.
 */

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

async function signedInUser(): Promise<string | null> {
  const session = await auth();
  const userId = session?.user?.id;
  return userId && session.twoFactor !== 'pending' ? userId : null;
}

/** What the dialog should ask for. */
export async function stepUpInfo(): Promise<Result<{ kind: StepUpKind }>> {
  const userId = await signedInUser();
  const kind = userId ? await stepUpKind(userId) : null;
  return kind ? { ok: true, data: { kind } } : { ok: false, error: 'not_signed_in' };
}

/** Checks the code or password; same attempt limit as opening locked invoices. */
export async function confirmStepUp(secret: string): Promise<Result<undefined>> {
  const userId = await signedInUser();
  if (!userId) return { ok: false, error: 'not_signed_in' };
  if (!allow(`stepup:${userId}`, { limit: 5, windowMs: 10 * 60 * 1000 })) return { ok: false, error: 'too_many_attempts' };
  const method = await verifyStepUp(userId, secret);
  if (!method) return { ok: false, error: 'not_signed_in' };
  if (method === 'invalid_code' || method === 'wrong_current' || method === 'reauth_required') return { ok: false, error: method };
  await grantUnlock(userId, method);
  return { ok: true, data: undefined };
}
