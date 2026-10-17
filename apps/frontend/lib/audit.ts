'use server';

import { apiFetch } from '@/lib/api-client';

export type AuditEntityType = 'invoice' | 'tenant' | 'bank_account' | 'contact' | 'member' | 'api_key' | 'import';

export interface AuditChange {
  field: string;
  from: unknown;
  to: unknown;
}

/** One row of Historie změn, as `GET /api/v1/audit-log` returns it. */
export interface AuditItem {
  id: string;
  entityType: AuditEntityType;
  entityId: string | null;
  entityLabel: string | null;
  action: string;
  changes: AuditChange[];
  reason: string | null;
  actor: 'user' | 'ai' | 'api_key' | 'system';
  createdAt: string;
  userName: string | null;
  userEmail: string | null;
}

export interface AuditPage {
  items: AuditItem[];
  hasMore: boolean;
}

export interface AuditQuery {
  entityType?: AuditEntityType;
  entityId?: string;
  /** `createdAt` of the last item shown — the next page starts below it. */
  before?: string;
  limit?: number;
  action?: string;
  userId?: string;
  /** Whole days, YYYY-MM-DD; `to` includes that day. */
  from?: string;
  to?: string;
}

/** A page of the company's change history, newest first; null when it cannot be loaded. */
export async function fetchAuditLog(query: AuditQuery = {}): Promise<AuditPage | null> {
  const params = new URLSearchParams();
  if (query.entityType) params.set('entity_type', query.entityType);
  if (query.entityId) params.set('entity_id', query.entityId);
  if (query.before) params.set('before', query.before);
  if (query.action) params.set('action', query.action);
  if (query.userId) params.set('user_id', query.userId);
  if (query.from) params.set('from', query.from);
  if (query.to) params.set('to', query.to);
  params.set('limit', String(query.limit ?? 30));
  try {
    return await apiFetch<AuditPage>(`/api/v1/audit-log?${params}`);
  } catch {
    return null;
  }
}
