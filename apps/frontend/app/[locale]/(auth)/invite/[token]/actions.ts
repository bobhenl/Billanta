'use server';

import { apiFetch } from '@/lib/api-client';
import { backendMessage } from '@/lib/action-error';

export async function acceptInvitation(token: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await apiFetch(`/api/v1/invitations/${encodeURIComponent(token)}/accept`, { method: 'POST' });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: backendMessage(error) };
  }
}
