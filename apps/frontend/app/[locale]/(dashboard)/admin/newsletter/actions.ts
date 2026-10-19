'use server';

import { revalidatePath } from 'next/cache';
import { apiFetch } from '@/lib/api-client';
import { backendMessage } from '@/lib/action-error';
import type { NewsletterCountry, NewsletterTopic } from '@/lib/newsletter';
import type { SettingsResult } from '../../settings/actions';

export interface IssueInput {
  locale: 'cs' | 'sk' | 'en';
  country: NewsletterCountry | null;
  topics: NewsletterTopic[];
  subject: string;
  body: string;
}

export interface AdminIssue extends IssueInput {
  id: string;
  status: 'draft' | 'sending' | 'sent';
  queuedCount: number;
  sentAt: string | null;
  createdAt: string;
  audience?: number;
}

async function call<T>(path: string, method: 'GET' | 'POST' | 'PUT' | 'DELETE', body?: unknown): Promise<SettingsResult<T>> {
  try {
    const data = await apiFetch<T>(path, {
      method,
      ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    });
    if (method !== 'GET') revalidatePath('/[locale]/(dashboard)/admin/newsletter', 'page');
    return { ok: true, data };
  } catch (error) {
    return { ok: false, error: backendMessage(error) };
  }
}

const issuePath = (id: string) => `/api/v1/admin/newsletter/issues/${encodeURIComponent(id)}`;

export async function getIssue(id: string) {
  return call<AdminIssue>(issuePath(id), 'GET');
}

export async function createIssue(input: IssueInput) {
  return call<AdminIssue>('/api/v1/admin/newsletter/issues', 'POST', input);
}

/** A draft built by the backend from recent blog posts and upcoming tax deadlines; the admin edits it before sending. */
export async function createDraftIssue(locale: IssueInput['locale'], country: NewsletterCountry | null) {
  return call<AdminIssue>('/api/v1/admin/newsletter/issues/draft', 'POST', { locale, country });
}

export async function updateIssue(id: string, input: Partial<IssueInput>) {
  return call<AdminIssue>(issuePath(id), 'PUT', input);
}

export async function deleteIssue(id: string) {
  return call<unknown>(issuePath(id), 'DELETE');
}

export async function previewIssue(id: string) {
  return call<{ subject: string; html: string; text: string }>(`${issuePath(id)}/preview`, 'GET');
}

/** Queues the issue for every confirmed subscriber in its audience; the e-mail worker sends it in batches. */
export async function sendIssue(id: string) {
  return call<AdminIssue>(`${issuePath(id)}/send`, 'POST');
}
