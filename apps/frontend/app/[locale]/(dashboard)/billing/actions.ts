'use server';

import { revalidatePath } from 'next/cache';
import { getLocale } from 'next-intl/server';
import { apiFetch } from '@/lib/api-client';
import { backendMessage } from '@/lib/action-error';
import type { PaidPlanKey } from '@/lib/plan';
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

export async function openPortal() {
  const locale = await getLocale();
  return post<{ url: string }>('/api/v1/billing/subscription/portal', { locale });
}

export async function requestBankTransfer(plan: PaidPlanKey, months: 1 | 12) {
  const result = await post<{ id: string; url?: undefined }>('/api/v1/billing/subscription/bank-transfer', { plan, months });
  if (result.ok) revalidatePath('/[locale]/(dashboard)/billing', 'page');
  return result;
}
