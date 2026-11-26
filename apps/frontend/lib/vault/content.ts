import { isSealed, open, seal, type VaultKey } from '@faktur/cz-compliance';
import type { PlainInvoice } from './types';

/**
 * Which invoice texts "Důvěrný režim" encrypts (category "texts"): item
 * descriptions and the three notes. Amounts, dates, numbers, symbols and the
 * customer stay readable, so lists, reports, the bank matching and VAT
 * filings keep working.
 */
interface SealableDraft {
  noteAbove?: string | null;
  noteBelow?: string | null;
  internalNote?: string | null;
  items?: { description: string }[] | null;
}

const sealText = async (key: VaultKey, value: string | null | undefined) => (value && value.trim() && !isSealed(value) ? seal(key, value) : value);
const openText = async (key: VaultKey, value: string | null | undefined) => (value && isSealed(value) ? open(key, value) : value);

export async function sealDraft<T extends SealableDraft>(key: VaultKey, draft: T): Promise<T> {
  return {
    ...draft,
    noteAbove: await sealText(key, draft.noteAbove),
    noteBelow: await sealText(key, draft.noteBelow),
    internalNote: await sealText(key, draft.internalNote),
    items: draft.items ? await Promise.all(draft.items.map(async (item) => ({ ...item, description: (await sealText(key, item.description)) ?? '' }))) : draft.items
  };
}

/** The editor's starting point with every envelope opened; plain values pass through. */
export async function openDraft<T extends SealableDraft>(key: VaultKey, draft: T): Promise<T> {
  return {
    ...draft,
    noteAbove: await openText(key, draft.noteAbove),
    noteBelow: await openText(key, draft.noteBelow),
    internalNote: await openText(key, draft.internalNote),
    items: draft.items ? await Promise.all(draft.items.map(async (item) => ({ ...item, description: (await openText(key, item.description)) ?? '' }))) : draft.items
  };
}

export function draftIsSealed(draft: SealableDraft | null | undefined): boolean {
  if (!draft) return false;
  return [draft.noteAbove, draft.noteBelow, draft.internalNote, ...(draft.items ?? []).map((i) => i.description)].some(isSealed);
}

/** For "Zašifrovat": the plain texts the server sent, each replaced by its envelope. */
export async function sealPlainInvoice(key: VaultKey, doc: PlainInvoice): Promise<PlainInvoice> {
  return {
    id: doc.id,
    invoiceNumber: doc.invoiceNumber,
    noteAbove: doc.noteAbove ? await seal(key, doc.noteAbove) : undefined,
    noteBelow: doc.noteBelow ? await seal(key, doc.noteBelow) : undefined,
    internalNote: doc.internalNote ? await seal(key, doc.internalNote) : undefined,
    items: await Promise.all(doc.items.map(async (item) => ({ id: item.id, description: await seal(key, item.description) })))
  };
}
