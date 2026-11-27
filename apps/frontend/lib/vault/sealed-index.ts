'use client';

import { isSealed, open, type VaultKey } from '@faktur/cz-compliance';
import { fetchVaultDocuments } from './actions';
import { openItemAmounts } from './amounts';
import { subscribeVaultKeys } from './session';
import type { VaultDocument } from './types';

/**
 * The company's encrypted texts, opened in this tab after unlock, for search
 * and item suggestions. Memory only: nothing opened here is written to
 * storage or sent anywhere, and the index goes away with the key.
 */
export interface SealedIndexEntry {
  id: string;
  /** Opened notes only; plain ones the server already searched. */
  notes: string[];
  /** Opened item lines only, with what a suggestion needs. */
  items: { description: string; code: string | null; unit: string | null; unitPrice: number | null; vatRate: number | null; createdAt: string }[];
}

export interface SealedIndex {
  entries: Map<string, SealedIndexEntry>;
  /** Locked documents the member has not re-authenticated for: not opened, not searched. */
  skippedLocked: number;
}

// A save or a seal elsewhere changes the texts; a minute old is fresh enough for typing ahead.
const TTL_MS = 60_000;

let cached: { tenantId: string; key: VaultKey; at: number; index: Promise<SealedIndex> } | null = null;
let subscribed = false;

export function invalidateSealedIndex(): void {
  cached = null;
}

/** Opens one envelope; a value this key cannot open (an old or broken one) is skipped, not fatal. */
export async function openOrNull(key: VaultKey, value: string | null | undefined): Promise<string | null> {
  if (!value || !isSealed(value)) return null;
  try {
    return await open(key, value);
  } catch {
    return null;
  }
}

/** Every page of `GET /vault/invoices/documents`, in id order. */
export async function fetchAllVaultDocuments(filter: { sealedOnly: boolean; from?: string; to?: string }): Promise<{ documents: VaultDocument[]; skippedLocked: number }> {
  const documents: VaultDocument[] = [];
  let skippedLocked = 0;
  let after: string | null = null;
  do {
    const page = await fetchVaultDocuments({ ...filter, after });
    if (!page.ok) throw new Error(page.error);
    documents.push(...page.value.documents);
    skippedLocked += page.value.skippedLocked;
    after = page.value.next;
  } while (after);
  return { documents, skippedLocked };
}

async function build(key: VaultKey): Promise<SealedIndex> {
  const { documents, skippedLocked } = await fetchAllVaultDocuments({ sealedOnly: true });
  const entries = new Map<string, SealedIndexEntry>();
  for (const doc of documents) {
    const notes = (await Promise.all([doc.internalNote, doc.noteAbove, doc.noteBelow].map((v) => openOrNull(key, v)))).filter((v): v is string => v !== null);
    const items: SealedIndexEntry['items'] = [];
    for (const item of doc.items) {
      const description = await openOrNull(key, item.description);
      if (description === null) continue;
      // A sealed item's plain price is the placeholder 0: suggest the opened one, or none.
      const amounts = isSealed(item.encAmounts) ? await openItemAmounts(key, item.encAmounts!).catch(() => null) : item;
      items.push({ description, code: item.code, unit: item.unit, unitPrice: amounts?.unitPrice ?? null, vatRate: amounts?.vatRate ?? null, createdAt: item.createdAt });
    }
    entries.set(doc.id, { id: doc.id, notes, items });
  }
  return { entries, skippedLocked };
}

export function loadSealedIndex(tenantId: string, key: VaultKey): Promise<SealedIndex> {
  if (!subscribed) {
    // Lock, logout or another company: whatever was opened with the old key goes.
    subscribeVaultKeys(invalidateSealedIndex);
    subscribed = true;
  }
  if (cached && cached.tenantId === tenantId && cached.key === key && Date.now() - cached.at < TTL_MS) return cached.index;
  const index = build(key);
  const entry = { tenantId, key, at: Date.now(), index };
  cached = entry;
  // A failed load is not kept, so the next keystroke tries again.
  index.catch(() => {
    if (cached === entry) cached = null;
  });
  return index;
}
