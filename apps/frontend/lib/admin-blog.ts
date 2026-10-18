import { notFound } from 'next/navigation';
import { ApiError, apiFetch } from '@/lib/api-client';
import type { BlogSource } from '@/lib/blog';

export type BlogStatus = 'draft' | 'pending_review' | 'published' | 'rejected';

export const BLOG_STATUS_TONE: Record<BlogStatus, string> = {
  pending_review: 'bg-warning/15 text-warning',
  draft: 'bg-muted text-muted-foreground',
  published: 'bg-success/15 text-success',
  rejected: 'bg-destructive/10 text-destructive'
};

/** A row of `GET /v1/admin/blog` (no body). */
export interface AdminBlogListItem {
  id: string;
  locale: 'cs' | 'sk' | 'en';
  slug: string;
  translationKey: string;
  title: string;
  kind: 'manual' | 'tax_deadlines' | 'brief';
  status: BlogStatus;
  warnings: string[];
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AdminBlogPost extends AdminBlogListItem {
  description: string;
  body: string;
  sources: BlogSource[];
  facts: string | null;
}

/** The backend's `blogPostSchema` (snake_case keys). */
export interface AdminBlogPostInput {
  locale: string;
  slug: string;
  translation_key?: string;
  title: string;
  description: string;
  body: string;
  sources: BlogSource[];
  facts?: string | null;
}

/**
 * Staff-only fetch. Anyone else gets a 404 rather than a 403 page, so the
 * admin area's existence isn't advertised.
 */
export async function adminBlogFetch<T>(path: string): Promise<T> {
  try {
    return await apiFetch<T>(`/api/v1/admin/blog${path}`);
  } catch (error) {
    if (error instanceof ApiError && (error.status === 401 || error.status === 403 || error.status === 404)) notFound();
    throw error;
  }
}
