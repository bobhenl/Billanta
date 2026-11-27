'use client';

import { sessionKey, type VaultKey } from '@faktur/cz-compliance';

/**
 * Where an unlocked company key lives in the browser: in memory, plus a
 * non-extractable CryptoKey in IndexedDB so a reload or a second tab does
 * not ask again. Script on the page can use such a key but never read its
 * bytes. It expires after IDLE_MS (unless kept on this device, below) and
 * is wiped on logout (`clearVaultKeys`).
 */
const DB_NAME = 'billanta-vault';
const STORE = 'keys';
const IDLE_MS = 12 * 3600 * 1000;

const memory = new Map<string, VaultKey>();
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((fn) => fn());

export function subscribeVaultKeys(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    // Private windows may refuse IndexedDB: the key then stays in memory only.
    req.onerror = () => resolve(null);
  });
}

async function withStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | undefined> {
  const db = await openDb();
  if (!db) return undefined;
  try {
    return await new Promise<T | undefined>((resolve) => {
      const req = run(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(undefined);
    });
  } finally {
    db.close();
  }
}

export function cachedVaultKey(tenantId: string): VaultKey | null {
  return memory.get(tenantId) ?? null;
}

/**
 * `keep`: "Pamatovat odemčení na tomto zařízení". The key then has no idle
 * expiry, so the e-mail outbox can work whenever a member opens the
 * dashboard here. Off by default; "Zamknout", turning it off and logout all
 * delete the key.
 */
interface StoredKey {
  key: VaultKey;
  at: number;
  keep?: boolean;
}

const readRow = (tenantId: string) => withStore<StoredKey | undefined>('readonly', (s) => s.get(tenantId));

export async function loadVaultKey(tenantId: string): Promise<VaultKey | null> {
  const hit = memory.get(tenantId);
  if (hit) return hit;
  const row = await readRow(tenantId);
  if (!row) return null;
  if (!row.keep && Date.now() - row.at > IDLE_MS) {
    await forgetVaultKey(tenantId);
    return null;
  }
  memory.set(tenantId, row.key);
  return row.key;
}

/** Keeps the key for this company; an extractable one is first turned into a non-extractable copy. */
export async function rememberVaultKey(tenantId: string, key: VaultKey): Promise<VaultKey> {
  const stored = key.extractable ? await sessionKey(key) : key;
  memory.set(tenantId, stored);
  const keep = (await readRow(tenantId))?.keep;
  await withStore('readwrite', (s) => s.put({ key: stored, at: Date.now(), ...(keep ? { keep } : {}) } satisfies StoredKey, tenantId));
  notify();
  return stored;
}

export async function keptOnDevice(tenantId: string): Promise<boolean> {
  return Boolean((await readRow(tenantId))?.keep);
}

/**
 * Turns "Pamatovat odemčení na tomto zařízení" on (needs the key unlocked
 * here) or off. Off puts the key back on the usual idle expiry; "Zamknout"
 * deletes it at once.
 */
export async function keepOnDevice(tenantId: string, keep: boolean): Promise<boolean> {
  const key = memory.get(tenantId) ?? (await readRow(tenantId))?.key;
  if (!key) return !keep;
  await withStore('readwrite', (s) => s.put({ key, at: Date.now(), ...(keep ? { keep: true } : {}) } satisfies StoredKey, tenantId));
  notify();
  return true;
}

export async function forgetVaultKey(tenantId: string): Promise<void> {
  memory.delete(tenantId);
  await withStore('readwrite', (s) => s.delete(tenantId));
  notify();
}

/** On logout: every company's key goes, from memory and from disk. */
export async function clearVaultKeys(): Promise<void> {
  memory.clear();
  notify();
  if (typeof indexedDB === 'undefined') return;
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
  });
}
