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
export async function reviewListing(id: string, status: 'approved' | 'rejected', note: string | null, updatedAt: string): Promise<SettingsResult> {
  try {
    await apiFetch(`/api/v1/admin/accountants/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status, note, updatedAt })
    });
    revalidatePath('/[locale]/(dashboard)/admin/accountants', 'page');
    return { ok: true, data: undefined };
  } catch (error) {
    return { ok: false, error: backendMessage(error) };
  }
}
