'use server';

import { apiFetch } from '@/lib/api-client';
import { backendMessage } from '@/lib/action-error';
import type { AccessLock } from '@/lib/record-lock';

export type LockKind = 'invoice' | 'expense' | 'contact';
type Result = { ok: true; data: { accessLock: AccessLock | null } } | { ok: false; error: string };

const PATHS: Record<LockKind, (id: string) => string> = {
  invoice: (id) => `/api/v1/invoices/${encodeURIComponent(id)}/access-lock`,
  expense: (id) => `/api/v1/expenses/${encodeURIComponent(id)}/access-lock`,
  // A client's lock travels with its owner, so it lives on the visibility route.
  contact: (id) => `/api/v1/contacts/${encodeURIComponent(id)}/visibility`
};

/** Locks, tightens or lifts; lifting or widening answers step_up_required first (the backend checks who may). */
export async function setAccessLock(kind: LockKind, id: string, level: AccessLock | null): Promise<Result> {
  try {
    const body = kind === 'contact' ? { accessLock: level } : { level };
    const data = await apiFetch<{ accessLock: AccessLock | null }>(PATHS[kind](id), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    return { ok: true, data };
  } catch (error) {
    return { ok: false, error: backendMessage(error) };
  }
}
