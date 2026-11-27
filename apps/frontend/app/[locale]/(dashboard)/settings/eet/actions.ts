'use server';

import { apiFetch } from '@/lib/api-client';
import { backendMessage } from '@/lib/action-error';
import type { EetRecord, EetSettings } from './types';

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

async function call<T>(path: string, method: string, body?: unknown): Promise<Result<T>> {
  try {
    const data = await apiFetch<T>(`/api/v1/tenants/me/eet${path}`, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    return { ok: true, data };
  } catch (error) {
    const code = backendMessage(error);
    return { ok: false, error: /^[a-z0-9_-]+$/.test(code) ? code : 'save_failed' };
  }
}

export async function saveEetSettings(input: Partial<Pick<EetSettings, 'enabled' | 'environment' | 'idJednotky' | 'idPokl' | 'cardInPerson'>>) {
  return call<EetSettings>('', 'PUT', input);
}

/** `p12` is the file as base64; the password goes only to the backend, which checks it and stores both encrypted. */
export async function uploadEetCertificate(p12: string, password: string) {
  return call<EetSettings>('/certificate', 'PUT', { p12, password });
}

export async function removeEetCertificate() {
  return call<EetSettings>('/certificate', 'DELETE');
}

export async function resendEetRecord(id: string) {
  return call<EetRecord>(`/records/${encodeURIComponent(id)}/resend`, 'POST');
}
