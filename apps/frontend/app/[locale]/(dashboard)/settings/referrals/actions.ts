'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { ApiError, apiFetch } from '@/lib/api-client';
import { backendMessage } from '@/lib/action-error';
import { REFERRAL_CODE, REFERRAL_COOKIE } from '@/lib/referral';
import type { SettingsResult } from '../actions';

/**
 * The visitor arrived with `?ref=` and has just founded a company: record
 * the invite once and drop the cookie. The backend silently ignores codes
 * that don't qualify (own code, older company, already invited), so a stale
 * cookie just disappears. A network failure keeps it for the next visit.
 */
export async function claimReferral(): Promise<{ credits: number }> {
  const jar = await cookies();
  const code = jar.get(REFERRAL_COOKIE)?.value;
  if (!code) return { credits: 0 };
  if (!REFERRAL_CODE.test(code)) {
    jar.delete(REFERRAL_COOKIE);
    return { credits: 0 };
  }
  try {
    const result = await apiFetch<{ claimed: boolean; credits: number }>('/api/v1/referrals/claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code })
    });
    jar.delete(REFERRAL_COOKIE);
    return { credits: result.claimed ? result.credits : 0 };
  } catch (error) {
    // A 4xx means the code itself is unusable; only retry on server/network trouble.
    if (error instanceof ApiError && error.status < 500) jar.delete(REFERRAL_COOKIE);
    return { credits: 0 };
  }
}

async function run<T>(path: string, method: string, body: unknown): Promise<SettingsResult<T>> {
  try {
    const data = await apiFetch<T>(path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    revalidatePath('/[locale]/(dashboard)/settings/referrals', 'page');
    return { ok: true, data };
  } catch (error) {
    return { ok: false, error: backendMessage(error) };
  }
}

export async function setReferralProgram(program: 'friend' | 'accountant') {
  return run<{ program: string }>('/api/v1/referrals/program', 'PATCH', { program });
}

export async function redeemCredits(plan: 'start' | 'plus' | 'business', months: 1 | 12) {
  return run<{ plan: string; until: string; balance: number }>('/api/v1/referrals/redeem', 'POST', { plan, months });
}
