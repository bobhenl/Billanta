'use server';

import { apiFetch, ApiError } from '@/lib/api-client';
import type { AiSettings } from '../../invoices/new/types';

/** `apiKey`: string = set (verified by the backend first), null = remove, undefined = keep. */
export async function saveAiSettings(input: {
  mode?: AiSettings['mode'];
  apiKey?: string | null;
}): Promise<{ ok: true; settings: AiSettings } | { ok: false; error: string }> {
  try {
    const settings = await apiFetch<AiSettings>('/api/v1/ai/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input)
    });
    return { ok: true, settings };
  } catch (error) {
    if (error instanceof ApiError) {
      try {
        const code = (JSON.parse(error.body) as { error?: string }).error;
        if (code && code.includes('_')) return { ok: false, error: code };
      } catch {
        // not JSON
      }
      if (error.status === 403) return { ok: false, error: 'not_allowed' };
    }
    return { ok: false, error: 'save_failed' };
  }
}
