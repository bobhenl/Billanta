'use server';

import { revalidatePath } from 'next/cache';
import { apiFetch } from '@/lib/api-client';
import { backendMessage } from '@/lib/action-error';
import type { AdminBlogPost, AdminBlogPostInput, AutoPublishKind, BlogAutopublish, TopicKind } from '@/lib/admin-blog';

export type AdminBlogResult<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

async function run<T>(path: string, method: string, body?: unknown): Promise<AdminBlogResult<T>> {
  try {
    const data = await apiFetch<T>(`/api/v1/admin/blog${path}`, {
      method,
      ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    });
    revalidatePath('/[locale]/(dashboard)/admin/blog', 'layout');
    return { ok: true, data };
  } catch (error) {
    return { ok: false, error: backendMessage(error) };
  }
}

export async function saveBlogPost(id: string, input: Partial<AdminBlogPostInput>) {
  return run<AdminBlogPost>(`/${id}`, 'PATCH', input);
}

export async function createBlogPost(input: AdminBlogPostInput) {
  return run<AdminBlogPost>('', 'POST', input);
}

export async function publishBlogPost(id: string, force: boolean) {
  return run<AdminBlogPost>(`/${id}/publish`, 'POST', { force });
}

export async function unpublishBlogPost(id: string) {
  return run<AdminBlogPost>(`/${id}/unpublish`, 'POST');
}

export async function rejectBlogPost(id: string) {
  return run<AdminBlogPost>(`/${id}/reject`, 'POST');
}

export async function deleteBlogPost(id: string) {
  return run<{ deleted: true }>(`/${id}`, 'DELETE');
}

/** Null when that month's post already exists or the month has no deadlines. */
export async function draftTaxDeadlines(year: number, month: number) {
  return run<AdminBlogPost | null>('/drafts/tax-deadlines', 'POST', { year, month });
}

/** Null when every topic of that kind already has a post in that locale. */
export async function draftNextTopic(kind: TopicKind, locale: 'cs' | 'sk') {
  return run<AdminBlogPost | null>('/drafts/next', 'POST', { kind, locale });
}

export async function setBlogAutopublish(kind: AutoPublishKind, enabled: boolean) {
  return run<BlogAutopublish>(`/autopublish/${kind}`, 'PUT', { enabled });
}

export async function draftBrief(input: { locale: string; topic: string; facts: string; sources: { title: string; url: string }[] }) {
  return run<AdminBlogPost>('/drafts/brief', 'POST', input);
}
