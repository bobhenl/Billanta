'use server';

import { auth } from '@/auth';
import { apiFetch } from '@/lib/api-client';
import { backendMessage } from '@/lib/action-error';
import { grantUnlock } from '@/lib/invoice-unlock';
import { allow } from '@/lib/rate-limit';
import { stepUpKind, verifyStepUp, type StepUpKind } from '@/lib/reauth';
import type { PasskeyAssertion } from '@/lib/vault/passkey';
import type { VaultStatus } from '@/lib/vault/types';

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

/** Whether one of the member's vault passkeys can confirm a step-up (older ones only unlock). */
async function hasStepUpPasskey(): Promise<boolean> {
  try {
    const vault = await apiFetch<VaultStatus>('/api/v1/vault/me');
    return vault.enabled && vault.wraps.some((w) => w.kind === 'passkey' && w.stepUp);
  } catch {
    return false;
  }
}

/** What the dialog should ask for, and whether a passkey can answer instead. */
export async function stepUpInfo(): Promise<Result<{ kind: StepUpKind; passkey: boolean }>> {
  const userId = await signedInUser();
  const kind = userId ? await stepUpKind(userId) : null;
  return kind ? { ok: true, data: { kind, passkey: await hasStepUpPasskey() } } : { ok: false, error: 'not_signed_in' };
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

/** A single-use challenge from the backend for the passkey to sign. */
export async function passkeyStepUpChallenge(): Promise<Result<{ challenge: string; credentialIds: string[] }>> {
  if (!(await signedInUser())) return { ok: false, error: 'not_signed_in' };
  try {
    return { ok: true, data: await apiFetch('/api/v1/vault/me/passkey/challenge', { method: 'POST' }) };
  } catch (error) {
    return { ok: false, error: backendMessage(error) };
  }
}

/**
 * The backend checks the signature against the key stored at registration
 * and burns the challenge; only its yes writes the step-up cookie.
 */
export async function confirmPasskeyStepUp(assertion: PasskeyAssertion): Promise<Result<undefined>> {
  const userId = await signedInUser();
  if (!userId) return { ok: false, error: 'not_signed_in' };
  if (!allow(`stepup:${userId}`, { limit: 5, windowMs: 10 * 60 * 1000 })) return { ok: false, error: 'too_many_attempts' };
  try {
    const r = await apiFetch<{ ok?: boolean; method?: string }>('/api/v1/vault/me/passkey/step-up', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(assertion)
    });
    if (r.ok !== true || r.method !== 'passkey') return { ok: false, error: 'passkey_failed' };
  } catch {
    return { ok: false, error: 'passkey_failed' };
  }
  await grantUnlock(userId, 'passkey');
  return { ok: true, data: undefined };
}
