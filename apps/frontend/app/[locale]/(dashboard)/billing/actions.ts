'use server';

import { cookies, headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { getLocale } from 'next-intl/server';
import { ApiError, apiFetch } from '@/lib/api-client';
import { backendMessage } from '@/lib/action-error';
import { clientIp } from '@/lib/client-ip';
import type { PaidPlanKey } from '@/lib/plan';
import { PROMO_CODE, PROMO_COOKIE, type PromoBenefit } from '@/lib/promo';
import type { SettingsResult } from '../settings/actions';

async function post<T>(path: string, body: unknown): Promise<SettingsResult<T>> {
  try {
    const data = await apiFetch<T>(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { ok: true, data };
  } catch (error) {
    return { ok: false, error: backendMessage(error) };
  }
}

/** Stripe Checkout URL; the client navigates there. */
export async function startCheckout(plan: PaidPlanKey, interval: 'month' | 'year', currency: 'CZK' | 'EUR') {
  const locale = await getLocale();
  return post<{ url: string }>('/api/v1/billing/subscription/checkout', { plan, interval, currency, locale });
}

/** Stripe Checkout in setup mode: saves a card for the longer trial, charges nothing. */
export async function startTrialCard() {
  const locale = await getLocale();
  return post<{ url: string }>('/api/v1/billing/subscription/trial-card', { locale });
}

export async function openPortal() {
  const locale = await getLocale();
  return post<{ url: string }>('/api/v1/billing/subscription/portal', { locale });
}

export interface SubscriptionInfo {
  interval: 'month' | 'year' | null;
  currency: 'CZK' | 'EUR' | null;
  periodEnd: string | null;
  cancelAt: string | null;
}

async function changeSubscription(path: string, body: unknown = {}) {
  const result = await post<SubscriptionInfo & { url?: undefined }>(`/api/v1/billing/subscription/${path}`, body);
  if (result.ok) revalidatePath('/[locale]/(dashboard)/billing', 'page');
  return result;
}

/** Stops renewal; the plan runs to the end of the paid period. */
export async function cancelSubscription() {
  return changeSubscription('cancel');
}

export async function resumeSubscription() {
  return changeSubscription('resume');
}

export async function switchInterval(interval: 'month' | 'year') {
  return changeSubscription('interval', { interval });
}

export async function requestBankTransfer(plan: PaidPlanKey, months: 1 | 12) {
  const result = await post<{ id: string; url?: undefined }>('/api/v1/billing/subscription/bank-transfer', { plan, months });
  if (result.ok) revalidatePath('/[locale]/(dashboard)/billing', 'page');
  return result;
}

/** Redeems a promo code; the backend limits attempts per visitor, so it gets the visitor's IP. */
async function redeem(code: string, source: 'signup' | 'billing') {
  const ip = clientIp({ headers: await headers() });
  const data = await apiFetch<PromoBenefit>('/api/v1/billing/promo-code', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(ip ? { 'x-guest-ip': ip } : {}) },
    body: JSON.stringify({ code, source })
  });
  revalidatePath('/[locale]/(dashboard)', 'layout');
  return data;
}

export async function redeemPromo(code: string): Promise<SettingsResult<PromoBenefit>> {
  try {
    return { ok: true, data: await redeem(code, 'billing') };
  } catch (error) {
    return { ok: false, error: backendMessage(error) };
  }
}

/**
 * The visitor signed up through a `?promo=` link and now owns the company:
 * redeem the code once and drop the cookie. A refused code (expired, used
 * up) is dropped too and reported, so the founder knows why nothing
 * changed; a network failure keeps it for the next visit.
 */
export async function claimPromo(): Promise<SettingsResult<PromoBenefit> | null> {
  const jar = await cookies();
  const code = jar.get(PROMO_COOKIE)?.value;
  if (!code) return null;
  if (!PROMO_CODE.test(code)) {
    jar.delete(PROMO_COOKIE);
    return null;
  }
  try {
    const data = await redeem(code, 'signup');
    jar.delete(PROMO_COOKIE);
    return { ok: true, data };
  } catch (error) {
    if (!(error instanceof ApiError) || error.status >= 500) return null;
    jar.delete(PROMO_COOKIE);
    return { ok: false, error: backendMessage(error) };
  }
}
