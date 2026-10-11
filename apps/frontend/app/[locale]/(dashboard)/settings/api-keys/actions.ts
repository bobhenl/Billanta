'use server';

import { revalidatePath } from 'next/cache';
import { apiFetch } from '@/lib/api-client';
import { backendMessage } from '@/lib/action-error';
import type { ApiKeyListItem } from './api-keys-manager';

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

/** `POST /api/v1/api-keys` — the only response that ever carries the full key. */
export async function createApiKey(name: string, readOnlyKey = false): Promise<Result<ApiKeyListItem & { key: string }>> {
  try {
    const data = await apiFetch<ApiKeyListItem & { key: string }>('/api/v1/api-keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name.trim(), scopes: readOnlyKey ? ['read'] : [] })
    });
    revalidatePath('/[locale]/(dashboard)/settings/api-keys', 'page');
    return { ok: true, data: { ...data, lastUsedAt: null, revokedAt: null } };
  } catch (error) {
    return { ok: false, error: backendMessage(error) };
  }
}

/** `DELETE /api/v1/api-keys/:id` — soft revoke, the row stays for the audit trail. */
export async function revokeApiKey(id: string): Promise<Result<{ id: string; revokedAt: string }>> {
  try {
    const data = await apiFetch<{ id: string; revokedAt: string }>(`/api/v1/api-keys/${encodeURIComponent(id)}`, { method: 'DELETE' });
    revalidatePath('/[locale]/(dashboard)/settings/api-keys', 'page');
    return { ok: true, data };
  } catch (error) {
    return { ok: false, error: backendMessage(error) };
  }
}
