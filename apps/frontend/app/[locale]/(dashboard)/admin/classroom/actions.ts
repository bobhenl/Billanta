'use server';

import { revalidatePath } from 'next/cache';
import { apiFetch } from '@/lib/api-client';
import { backendMessage } from '@/lib/action-error';
import type { SettingsResult } from '../../settings/actions';

async function post(path: string, body: unknown): Promise<SettingsResult> {
  try {
    await apiFetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    revalidatePath('/[locale]/(dashboard)/admin/classroom', 'page');
    return { ok: true, data: undefined };
  } catch (error) {
    return { ok: false, error: backendMessage(error) };
  }
}

/**
 * Approving also verifies the school; `emailDomain` is the domain staff
 * confirmed, which lets colleagues on it in without another review.
 */
export async function decideTeacher(id: string, decision: 'approve' | 'reject', note: string, emailDomain: string): Promise<SettingsResult> {
  return post(`/api/v1/admin/classroom/teachers/${encodeURIComponent(id)}/decision`, {
    decision,
    note: note || undefined,
    emailDomain: decision === 'approve' && emailDomain ? emailDomain : undefined
  });
}

export async function suspendSchool(id: string, suspended: boolean, note: string): Promise<SettingsResult> {
  return post(`/api/v1/admin/classroom/schools/${encodeURIComponent(id)}/suspend`, { suspended, note: note || undefined });
}
