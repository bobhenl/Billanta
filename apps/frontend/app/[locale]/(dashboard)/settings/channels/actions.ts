'use server';

import { revalidatePath } from 'next/cache';
import { apiFetch } from '@/lib/api-client';
import { backendMessage } from '@/lib/action-error';

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

const PAGE = '/[locale]/(dashboard)/settings/channels';

export interface LinkingCode {
  id: string;
  channel: 'telegram' | 'whatsapp';
  linkingToken: string;
  expiresAt: string;
}

/** `POST /api/v1/channel-links`: a single-use code, valid for 30 minutes (owner/admin only). */
export async function createLinkingCode(channel: 'telegram' = 'telegram'): Promise<Result<LinkingCode>> {
  try {
    const data = await apiFetch<LinkingCode>('/api/v1/channel-links', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel })
    });
    return { ok: true, data };
  } catch (error) {
    return { ok: false, error: backendMessage(error) };
  }
}

/** `DELETE /api/v1/channel-links/:id`: the chat stops creating invoices for this company. */
export async function unlinkChannel(id: string): Promise<Result<null>> {
  try {
    await apiFetch(`/api/v1/channel-links/${encodeURIComponent(id)}`, { method: 'DELETE' });
    revalidatePath(PAGE, 'page');
    return { ok: true, data: null };
  } catch (error) {
    return { ok: false, error: backendMessage(error) };
  }
}
