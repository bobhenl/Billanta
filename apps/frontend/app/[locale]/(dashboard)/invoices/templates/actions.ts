'use server';

import { revalidatePath } from 'next/cache';
import { apiFetch } from '@/lib/api-client';
import { backendMessage } from '@/lib/action-error';

type Result<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

async function call<T>(path: string, init: RequestInit): Promise<Result<T>> {
  try {
    const data = await apiFetch<T>(path, init);
    revalidatePath('/[locale]/(dashboard)/invoices', 'layout');
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

export async function renameTemplate(id: string, name: string, description: string) {
  return call<unknown>(`/api/v1/invoice-templates/${id}`, json('PATCH', { name, description: description || null }));
}

export async function deleteTemplate(id: string) {
  return call<unknown>(`/api/v1/invoice-templates/${id}`, { method: 'DELETE' });
}

export async function bulkInvoice(templateId: string, contactIds: string[], issueDate: string, issue: boolean) {
  return call<{ count: number }>(
    `/api/v1/invoice-templates/${templateId}/bulk`,
    json('POST', { contact_ids: contactIds, issue_date: issueDate || undefined, issue })
  );
}
