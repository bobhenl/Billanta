'use server';

import { revalidatePath } from 'next/cache';
import { apiFetch, ApiError } from '@/lib/api-client';
import type { Project, TimeEntry } from '@/lib/time-ui';

export type ActionResult<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

async function run<T>(path: string, init: RequestInit): Promise<ActionResult<T>> {
  try {
    const data = await apiFetch<T>(path, init);
    revalidatePath('/[locale]/(dashboard)/time', 'layout');
    revalidatePath('/[locale]/(dashboard)/dashboard', 'page');
    return { ok: true, data };
  } catch (error) {
    return { ok: false, error: backendMessage(error) };
  }
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body)
});

export interface ProjectInput {
  name?: string;
  contact_id?: string | null;
  hourly_rate?: number | null;
  currency?: string;
  color?: string | null;
  archived?: boolean;
}

export interface EntryInput {
  description?: string;
  project_id?: string | null;
  contact_id?: string | null;
  hourly_rate?: number | null;
  billable?: boolean;
  started_at?: string;
  minutes?: number;
}

export async function createProject(input: ProjectInput) {
  return run<Project>('/api/v1/projects', json('POST', input));
}

export async function updateProject(id: string, input: ProjectInput) {
  return run<Project>(`/api/v1/projects/${id}`, json('PATCH', input));
}

export async function deleteProject(id: string) {
  return run<undefined>(`/api/v1/projects/${id}`, { method: 'DELETE' });
}

export async function startTimer(input: Pick<EntryInput, 'description' | 'project_id' | 'billable'>) {
  return run<TimeEntry>('/api/v1/time-entries/start', json('POST', input));
}

export async function stopTimer(id: string) {
  return run<TimeEntry>(`/api/v1/time-entries/${id}/stop`, { method: 'POST' });
}

export async function createEntry(input: EntryInput) {
  return run<TimeEntry>('/api/v1/time-entries', json('POST', input));
}

export async function updateEntry(id: string, input: EntryInput) {
  return run<TimeEntry>(`/api/v1/time-entries/${id}`, json('PATCH', input));
}

export async function deleteEntry(id: string) {
  return run<undefined>(`/api/v1/time-entries/${id}`, { method: 'DELETE' });
}

export async function invoiceEntries(entryIds: string[], groupBy: 'entry' | 'project' | 'day', contactId?: string) {
  return run<{ id: string }>(
    '/api/v1/time-entries/invoice',
    json('POST', { entry_ids: entryIds, group_by: groupBy, ...(contactId ? { contact_id: contactId } : {}) })
  );
}

function backendMessage(error: unknown): string {
  if (error instanceof ApiError) {
    try {
      const body = JSON.parse(error.body) as { message?: unknown; error?: unknown };
      const message = Array.isArray(body.message) ? body.message.join(', ') : body.message ?? body.error;
      if (typeof message === 'string') return message;
    } catch {
      // not JSON — fall through
    }
    return `HTTP ${error.status}`;
  }
  return error instanceof Error ? error.message : String(error);
}
