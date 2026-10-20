import { ApiError } from './api-client';
import { currentOfflineScope } from './offline-scope';
import { errorCode } from '@/app/[locale]/(dashboard)/invoices/new/invoice-body';

/**
 * Shared by the offline sync actions and the voice-note Route Handler.
 *
 * Outcome of sending one queued offline item. The item id doubles as the
 * `Idempotency-Key`, so a retry after a lost response returns the record
 * the first attempt created instead of a second one.
 *
 * `retry`: nothing was decided (no connection to the backend, a 5xx, the
 * session or company changed) – keep the item and try later.
 */
export type SyncResult =
  | { ok: true; id: string | null }
  | { ok: false; kind: 'conflict'; contactId: string; legalName: string }
  | { ok: false; kind: 'failed'; error: string }
  | { ok: false; kind: 'retry'; error: string };

/** A different user or company than the item was written under: never send it, keep it for its owner. */
export async function checkScope(scope: string): Promise<SyncResult | null> {
  const current = await currentOfflineScope().catch(() => null);
  return current === scope ? null : { ok: false, kind: 'retry', error: 'scope_mismatch' };
}

export function failure(error: unknown): SyncResult {
  if (!(error instanceof ApiError) || error.status >= 500 || error.status === 429) {
    return { ok: false, kind: 'retry', error: 'network' };
  }
  const code = errorCode(error, `http_${error.status}`);
  // The record was created by an earlier attempt and deleted since; sending it again would resurrect it.
  if (code === 'idempotent_resource_deleted') return { ok: true, id: null };
  if (code === 'ico_taken') {
    try {
      const body = JSON.parse(error.body) as { contactId?: string; legalName?: string };
      if (body.contactId) return { ok: false, kind: 'conflict', contactId: body.contactId, legalName: body.legalName ?? '' };
    } catch {
      // fall through to a plain failure
    }
  }
  return { ok: false, kind: 'failed', error: code };
}
