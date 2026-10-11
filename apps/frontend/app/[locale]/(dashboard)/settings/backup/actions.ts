'use server';

import { revalidatePath } from 'next/cache';
import { apiFetch } from '@/lib/api-client';
import { backendMessage } from '@/lib/action-error';
import type { BackupDestinationListItem, BackupEncryptionInput, BackupSchedule, SftpInput } from './backup-destinations-manager';

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

const PAGE = '/[locale]/(dashboard)/settings/backup';

/**
 * `POST /api/v1/backup-destinations` — webhook, SFTP or local download. A
 * webhook's signing secret is in THIS response only (reveal once, like API
 * keys); an SFTP destination without a password answers with the public key
 * to authorize on the server.
 */
export async function createBackupDestination(
  input:
    | { type: 'webhook'; webhookUrl: string; schedule: BackupSchedule }
    | { type: 'sftp'; sftp: SftpInput; schedule: BackupSchedule }
    | { type: 'local' }
): Promise<Result<BackupDestinationListItem & { secret?: string }>> {
  try {
    const body =
      input.type === 'local'
        ? { type: 'local', schedule: 'manual' }
        : input.type === 'webhook'
          ? { ...input, webhookUrl: input.webhookUrl.trim() }
          : input;
    const data = await apiFetch<BackupDestinationListItem & { secret?: string }>('/api/v1/backup-destinations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    revalidatePath(PAGE, 'page');
    return { ok: true, data };
  } catch (error) {
    return { ok: false, error: backendMessage(error) };
  }
}

/** `PATCH /api/v1/backup-destinations/:id` — schedule / pause / file encryption. */
export async function updateBackupDestination(
  id: string,
  patch: { schedule?: BackupSchedule; isActive?: boolean; encryption?: BackupEncryptionInput }
): Promise<Result<BackupDestinationListItem>> {
  try {
    const data = await apiFetch<BackupDestinationListItem>(`/api/v1/backup-destinations/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch)
    });
    revalidatePath(PAGE, 'page');
    return { ok: true, data };
  } catch (error) {
    return { ok: false, error: backendMessage(error) };
  }
}

/** `DELETE /api/v1/backup-destinations/:id` — also drops its run history. */
export async function deleteBackupDestination(id: string): Promise<Result<null>> {
  try {
    await apiFetch(`/api/v1/backup-destinations/${encodeURIComponent(id)}`, { method: 'DELETE' });
    revalidatePath(PAGE, 'page');
    return { ok: true, data: null };
  } catch (error) {
    return { ok: false, error: backendMessage(error) };
  }
}

/** Fresh list after a run, so last-run time and status come from the server. */
export async function listBackupDestinations(): Promise<Result<BackupDestinationListItem[]>> {
  try {
    return { ok: true, data: await apiFetch<BackupDestinationListItem[]>('/api/v1/backup-destinations') };
  } catch (error) {
    return { ok: false, error: backendMessage(error) };
  }
}
