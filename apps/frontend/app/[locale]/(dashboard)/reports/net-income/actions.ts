'use server';

import { revalidatePath } from 'next/cache';
import { apiFetch } from '@/lib/api-client';
import { backendMessage } from '@/lib/action-error';
import type { Shares, TaxModel } from '@/lib/net-income';
import type { SettingsResult } from '../../settings/actions';

async function put<T>(path: string, body: unknown): Promise<SettingsResult<T>> {
  try {
    const data = await apiFetch<T>(path, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    revalidatePath('/[locale]/(dashboard)/reports/net-income', 'page');
    return { ok: true, data };
  } catch (error) {
    return { ok: false, error: backendMessage(error) };
  }
}

/** Owner/admin only (the backend keeps it under v1/tenants). */
export async function saveTaxModel(model: TaxModel) {
  return put<TaxModel>('/api/v1/tenants/me/tax-model', model);
}

/** One invoice's split between partners; null = the default shares. */
export async function setInvoicePartnerShares(id: string, shares: Shares | null) {
  return put<unknown>(`/api/v1/invoices/${encodeURIComponent(id)}/partner-shares`, { shares });
}
