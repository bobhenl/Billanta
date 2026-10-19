'use server';

import { revalidatePath } from 'next/cache';
import { apiFetch } from '@/lib/api-client';
import { backendMessage } from '@/lib/action-error';
import type { SettingsResult } from '../../settings/actions';

/**
 * Approve or reject one directory listing. `updatedAt` is the version the
 * admin looked at; the backend answers `listing_changed` if the accountant
 * edited it since, so an unseen edit is never approved.
 */
export async function reviewListing(
  id: string,
  status: 'approved' | 'rejected',
  note: string | null,
  updatedAt: string,
  partner = false
): Promise<SettingsResult> {
  return patch(`/api/v1/admin/accountants/${encodeURIComponent(id)}`, { status, note, updatedAt, partner });
}

/** Decide the accountant partner tier alone (the listing was reviewed before), or revoke it. */
export async function reviewPartner(tenantId: string, status: 'approved' | 'rejected', note: string | null): Promise<SettingsResult> {
  return patch(`/api/v1/admin/accountants/partner/${encodeURIComponent(tenantId)}`, { status, note });
}

async function patch(path: string, body: unknown): Promise<SettingsResult> {
  try {
    await apiFetch(path, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    revalidatePath('/[locale]/(dashboard)/admin/accountants', 'page');
    return { ok: true, data: undefined };
  } catch (error) {
    return { ok: false, error: backendMessage(error) };
  }
}
