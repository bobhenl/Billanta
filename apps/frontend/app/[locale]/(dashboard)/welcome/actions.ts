'use server';

import { revalidatePath } from 'next/cache';
import { apiFetch } from '@/lib/api-client';
import { backendMessage } from '@/lib/action-error';
import type { SettingsResult } from '../settings/actions';

export type GuestImportResult = { invoices: number; contactsCreated: number; skipped: { number: string; reason: string }[] };

/** The invoices made as a guest on /create-invoice, as this browser kept them (`lib/guest-invoices.ts`). */
export async function importGuestInvoices(invoices: unknown[]): Promise<SettingsResult<GuestImportResult>> {
  try {
    const data = await apiFetch<GuestImportResult>('/api/v1/invoices/import/guest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ invoices })
    });
    revalidatePath('/[locale]/(dashboard)', 'layout');
    return { ok: true, data };
  } catch (error) {
    return { ok: false, error: backendMessage(error) };
  }
}
