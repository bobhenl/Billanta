'use server';

import { apiFetch } from '@/lib/api-client';
import { backendMessage } from '@/lib/action-error';

import type { EmailPrefs, QuietHours } from '@/lib/notifications';

export async function fetchEmailPrefs(): Promise<EmailPrefs | null> {
  try {
    return await apiFetch<EmailPrefs>('/api/v1/me/notifications/email');
  } catch {
    return null;
  }
}

export async function saveEmailPrefs(patch: {
  types?: Record<string, boolean>;
  quiet_hours?: Partial<Pick<QuietHours, 'enabled' | 'start' | 'end'>> & { time_zone?: string };
}): Promise<{ ok: true; data: EmailPrefs } | { ok: false; error: string }> {
  try {
    const data = await apiFetch<EmailPrefs>('/api/v1/me/notifications/email', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch)
    });
    return { ok: true, data };
  } catch (error) {
    return { ok: false, error: backendMessage(error) };
  }
}
