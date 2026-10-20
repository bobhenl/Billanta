'use client';

import type { ContactInput } from '@/app/[locale]/(dashboard)/contacts/actions';
import type { InvoiceDraftInput } from '@/app/[locale]/(dashboard)/invoices/new/types';
import { syncOfflineContact, syncOfflineInvoice, type SyncResult } from './offline-sync-actions';

/** Path of the Route Handler that uploads a queued voice note. */
const VOICE_ENDPOINT = '/api/offline/voice';

/**
 * Drafts written without a connection, waiting to be sent (see
 * docs/offline-drafts-plan.md). Every item carries the `${userId}:${tenantId}`
 * scope it was written under; only the current scope is ever listed or sent,
 * and a different scope on page load wipes the queue, so a shared device
 * never hands one account's drafts to another.
 */

export type OutboxItem =
  | (OutboxBase & { kind: 'contact'; payload: ContactInput })
  | (OutboxBase & { kind: 'invoice'; payload: InvoiceDraftInput })
  | (OutboxBase & { kind: 'voice'; payload: VoiceNotePayload });

/**
 * A voice note recorded offline. On sync the backend transcribes it and
 * creates a `pending_review` draft from it; nothing is filled in on this
 * device. IndexedDB stores the Blob as is.
 */
export interface VoiceNotePayload {
  audio: Blob;
  mimeType: string;
  durationMs: number;
  /** The dashboard locale, a hint for the transcription language. */
  locale: string;
}

interface OutboxBase {
  /** Also the Idempotency-Key. */
  id: string;
  scope: string;
  label: string;
  createdAt: number;
  status: 'pending' | 'conflict' | 'failed';
  error?: string;
  conflict?: { contactId: string; legalName: string };
}

export type NewOutboxItem =
  | { kind: 'contact'; scope: string; label: string; payload: ContactInput }
  | { kind: 'invoice'; scope: string; label: string; payload: InvoiceDraftInput }
  | { kind: 'voice'; scope: string; label: string; payload: VoiceNotePayload };

const DB_NAME = 'billanta-offline';
const STORE = 'outbox';
const META = 'meta';
const PAGES_CACHE = 'billanta-pages-v1';
const CHANGE_EVENT = 'billanta-outbox-change';
/** sessionStorage: when this tab last asked the worker to refresh the offline pages. */
export const OFFLINE_WARM_KEY = 'billanta-offline-warm';
/** Prefix of a contact id that only exists in the queue so far. */
export const OFFLINE_CONTACT_PREFIX = 'offline:';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE, { keyPath: 'id' });
      req.result.createObjectStore(META);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(stores: string[], mode: IDBTransactionMode, run: (t: IDBTransaction) => IDBRequest<T> | void): Promise<T | undefined> {
  const db = await openDb();
  try {
    return await new Promise<T | undefined>((resolve, reject) => {
      const t = db.transaction(stores, mode);
      const req = run(t);
      t.oncomplete = () => resolve(req ? req.result : undefined);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  } finally {
    db.close();
  }
}

function announce() {
  window.dispatchEvent(new Event(CHANGE_EVENT));
  // Other tabs: their indicator re-reads the queue.
  try {
    const channel = new BroadcastChannel(CHANGE_EVENT);
    channel.postMessage('change');
    channel.close();
  } catch {
    // no BroadcastChannel
  }
}

/** Calls `listener` whenever the queue changes in this or another tab. */
export function onOutboxChange(listener: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, listener);
  let channel: BroadcastChannel | null = null;
  try {
    channel = new BroadcastChannel(CHANGE_EVENT);
    channel.onmessage = listener;
  } catch {
    // no BroadcastChannel
  }
  return () => {
    window.removeEventListener(CHANGE_EVENT, listener);
    channel?.close();
  };
}

async function allItems(): Promise<OutboxItem[]> {
  return (await tx<OutboxItem[]>([STORE], 'readonly', (t) => t.objectStore(STORE).getAll())) ?? [];
}

export async function listOutbox(scope: string): Promise<OutboxItem[]> {
  return (await allItems()).filter((item) => item.scope === scope).sort((a, b) => a.createdAt - b.createdAt);
}

export async function queueOffline(item: NewOutboxItem): Promise<OutboxItem> {
  const full = { ...item, id: crypto.randomUUID(), createdAt: Date.now(), status: 'pending' } as OutboxItem;
  await putItem(full);
  announce();
  return full;
}

async function putItem(item: OutboxItem) {
  await tx([STORE], 'readwrite', (t) => void t.objectStore(STORE).put(item));
}

async function deleteItem(id: string) {
  await tx([STORE], 'readwrite', (t) => void t.objectStore(STORE).delete(id));
}

/** Deletes every queued item of every scope and the cached dashboard pages. */
export async function clearOfflineData() {
  try {
    await tx([STORE, META], 'readwrite', (t) => {
      t.objectStore(STORE).clear();
      t.objectStore(META).clear();
    });
  } catch {
    // IndexedDB unavailable (private mode): nothing was stored either
  }
  await clearCachedPages();
  announce();
}

/** The cached dashboard HTML holds company data; drop it whenever the account may change hands. */
export async function clearCachedPages() {
  try {
    sessionStorage.removeItem(OFFLINE_WARM_KEY);
    await caches.delete(PAGES_CACHE);
  } catch {
    // no Cache API
  }
}

/**
 * Called once per dashboard load. If the queue or the page cache was
 * written under another user or company, both are wiped before anything is
 * shown.
 */
export async function claimOfflineScope(scope: string) {
  try {
    const stored = await tx<string | undefined>([META], 'readonly', (t) => t.objectStore(META).get('scope'));
    const foreign = stored !== undefined ? stored !== scope : (await allItems()).some((item) => item.scope !== scope);
    if (foreign) await clearOfflineData();
    await tx([META], 'readwrite', (t) => void t.objectStore(META).put(scope, 'scope'));
  } catch {
    await clearCachedPages();
  }
}

/** Resolves a conflict by pointing everything that waited for the queued contact at the existing one. */
export async function adoptExistingContact(scope: string, item: OutboxItem) {
  if (item.kind !== 'contact' || !item.conflict) return;
  await remapContact(scope, item.id, item.conflict.contactId);
  await deleteItem(item.id);
  announce();
}

/** Drops an item. Invoices that waited for a dropped contact lose their customer (a draft may have none). */
export async function discardItem(scope: string, item: OutboxItem) {
  if (item.kind === 'contact') await remapContact(scope, item.id, null);
  await deleteItem(item.id);
  announce();
}

export async function retryItem(item: OutboxItem) {
  await putItem({ ...item, status: 'pending', error: undefined, conflict: undefined });
  announce();
}

async function remapContact(scope: string, localId: string, contactId: string | null) {
  const ref = OFFLINE_CONTACT_PREFIX + localId;
  for (const item of await listOutbox(scope)) {
    if (item.kind !== 'invoice' || item.payload.customer?.kind !== 'contact' || item.payload.customer.id !== ref) continue;
    await putItem({ ...item, payload: { ...item.payload, customer: contactId ? { kind: 'contact', id: contactId } : null } });
  }
}

let running: Promise<void> | null = null;

/**
 * Sends the current scope's pending items, oldest first, contacts before
 * invoices and voice notes last (each one is a slow AI round trip). A Web Lock keeps it to one tab at a time; the first item that
 * cannot be decided (no connection) ends the run, the next trigger retries.
 */
export function syncOutbox(scope: string): Promise<void> {
  if (typeof navigator === 'undefined' || !navigator.onLine) return Promise.resolve();
  if (running) return running;
  const work = () => drain(scope);
  const locked: Promise<void> = navigator.locks ? navigator.locks.request('billanta-outbox', work).then(() => undefined) : work();
  const run = locked
    .catch(() => undefined)
    .finally(() => {
      running = null;
    });
  running = run;
  return run;
}

async function drain(scope: string) {
  const items = await listOutbox(scope);
  const ordered = (['contact', 'invoice', 'voice'] as const).flatMap((kind) => items.filter((i) => i.kind === kind));
  for (const queued of ordered) {
    // Re-read: a contact synced earlier in this run may have rewritten this invoice.
    const item = (await listOutbox(scope)).find((i) => i.id === queued.id);
    if (!item || item.status !== 'pending') continue;
    if (item.kind === 'invoice' && item.payload.customer?.kind === 'contact' && item.payload.customer.id.startsWith(OFFLINE_CONTACT_PREFIX)) {
      continue; // its contact is still queued (conflict or failed): it waits for the user's decision
    }
    let result: SyncResult;
    try {
      result =
        item.kind === 'contact'
          ? await syncOfflineContact(scope, item.id, item.payload)
          : item.kind === 'invoice'
            ? await syncOfflineInvoice(scope, item.id, item.payload)
            : await uploadVoiceNote(scope, item.id, item.payload);
    } catch {
      // The action did not run (offline again, or a deploy changed the action ids): keep the item.
      return;
    }
    if (result.ok) {
      if (item.kind === 'contact') await remapContact(scope, item.id, result.id);
      await deleteItem(item.id);
    } else if (result.kind === 'retry') {
      return;
    } else if (result.kind === 'conflict') {
      await putItem({ ...item, status: 'conflict', conflict: { contactId: result.contactId, legalName: result.legalName } });
    } else {
      await putItem({ ...item, status: 'failed', error: result.error });
    }
    announce();
  }
}

/**
 * Voice notes are over the 1 MB server-action limit, so they go through a
 * Route Handler that answers with the same `SyncResult`. Anything that is
 * not such an answer (offline again, a proxy error page) is a retry.
 */
async function uploadVoiceNote(scope: string, key: string, note: VoiceNotePayload): Promise<SyncResult> {
  const body = new FormData();
  body.set('audio', note.audio, `voice-note.${extensionOf(note.mimeType)}`);
  body.set('locale', note.locale);
  try {
    const res = await fetch(VOICE_ENDPOINT, {
      method: 'POST',
      headers: { 'Idempotency-Key': key, 'X-Offline-Scope': scope },
      body
    });
    const result = (await res.json()) as SyncResult;
    return typeof result?.ok === 'boolean' ? result : { ok: false, kind: 'retry', error: 'network' };
  } catch {
    return { ok: false, kind: 'retry', error: 'network' };
  }
}

function extensionOf(mimeType: string) {
  const sub = mimeType.split(';')[0]!.split('/')[1] ?? 'webm';
  return sub === 'mpeg' ? 'mp3' : sub.replace(/^x-/, '');
}

/** Contacts written offline that an invoice can already point at. */
export async function offlineContacts(scope: string) {
  return (await listOutbox(scope)).filter((item): item is Extract<OutboxItem, { kind: 'contact' }> => item.kind === 'contact');
}
