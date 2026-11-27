import {
  documentKeyWrap,
  generateDocumentKey,
  isSealed,
  open,
  seal,
  sealWithDocumentKey,
  unwrapDocumentKey,
  type DocumentKey,
  type VaultKey
} from '@faktur/cz-compliance';
import type { PlainInvoice } from './types';

/**
 * Which invoice texts "Důvěrný režim" encrypts (category "texts"): item
 * descriptions and the three notes. Amounts, dates, numbers, symbols and the
 * customer stay readable, so lists, reports, the bank matching and VAT
 * filings keep working.
 *
 * The printed texts (descriptions, notes above and below) use a key of the
 * document, which the client link can carry. The internal note stays under
 * the company key: the client must never be able to open it.
 */
interface SealableDraft {
  noteAbove?: string | null;
  noteBelow?: string | null;
  internalNote?: string | null;
  /** Category "amounts": the totals envelope; the items carry their own. */
  encAmounts?: string | null;
  items?: { description: string; encAmounts?: string | null }[] | null;
}

const sealText = async (key: VaultKey, value: string | null | undefined) => (value && value.trim() && !isSealed(value) ? seal(key, value) : value);
const sealPrinted = async (doc: DocumentKey, value: string | null | undefined) =>
  value && value.trim() && !isSealed(value) ? sealWithDocumentKey(doc, value) : value;
const openText = async (key: VaultKey, value: string | null | undefined) => (value && isSealed(value) ? open(key, value) : value);

/** The printed texts, the ones the client sees (sealed amounts included, they share the document key). */
export function printedTexts(draft: SealableDraft | null | undefined): (string | null | undefined)[] {
  if (!draft) return [];
  return [
    draft.noteAbove,
    draft.noteBelow,
    ...(draft.items ?? []).map((i) => i.description),
    draft.encAmounts,
    ...(draft.items ?? []).map((i) => i.encAmounts)
  ];
}

/**
 * The key the document already uses (so a link sent earlier keeps opening
 * it after an edit), or a fresh one for a new document.
 */
export async function documentKeyFor(key: VaultKey, existing: SealableDraft | null | undefined): Promise<DocumentKey> {
  const wrap = printedTexts(existing).map(documentKeyWrap).find(Boolean);
  if (wrap) {
    try {
      return await unwrapDocumentKey(key, wrap);
    } catch {
      // A wrap this company key can't open (copied from elsewhere): start a new key.
    }
  }
  return generateDocumentKey(key);
}

export async function sealDraft<T extends SealableDraft>(key: VaultKey, draft: T, doc?: DocumentKey): Promise<T> {
  const docKey = doc ?? (await generateDocumentKey(key));
  return {
    ...draft,
    noteAbove: await sealPrinted(docKey, draft.noteAbove),
    noteBelow: await sealPrinted(docKey, draft.noteBelow),
    internalNote: await sealText(key, draft.internalNote),
    items: draft.items
      ? await Promise.all(draft.items.map(async (item) => ({ ...item, description: (await sealPrinted(docKey, item.description)) ?? '' })))
      : draft.items
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
  let docKey: DocumentKey | null = null;
  if (doc.documentKeyWrap) docKey = await unwrapDocumentKey(key, doc.documentKeyWrap).catch(() => null);
  docKey ??= await generateDocumentKey(key);
  return {
    id: doc.id,
    invoiceNumber: doc.invoiceNumber,
    noteAbove: doc.noteAbove ? await sealWithDocumentKey(docKey, doc.noteAbove) : undefined,
    noteBelow: doc.noteBelow ? await sealWithDocumentKey(docKey, doc.noteBelow) : undefined,
    internalNote: doc.internalNote ? await seal(key, doc.internalNote) : undefined,
    items: await Promise.all(doc.items.map(async (item) => ({ id: item.id, description: await sealWithDocumentKey(docKey, item.description) })))
  };
}

type BuyerField = 'legalName' | 'addressStreet' | 'addressCity' | 'addressPostalCode';

export interface SealedDocument {
  noteAbove: string | null;
  noteBelow: string | null;
  items: { id: string; description: string }[];
  /** The encrypted fields of the buyer snapshot (contacts category). The client sees them printed. */
  buyer?: Partial<Record<BuyerField, string>>;
  buyerContactPerson?: string | null;
  /** Category "amounts": the totals envelope and each item's, in `items` order. */
  encAmounts?: string | null;
  itemAmounts?: { id: string; encAmounts: string }[];
}

/** Ciphertext only: what "Připravit odkaz pro klienta" sends to the server. Never a key. */
export interface RekeyPayload {
  noteAbove?: string;
  noteBelow?: string;
  items: { id: string; description: string }[];
  buyer?: Partial<Record<BuyerField, string>>;
  buyerContactPerson?: string;
  encAmounts?: string;
  itemAmounts?: { id: string; encAmounts: string }[];
}

/**
 * The document key for the client link. When the sealed printed texts are
 * not all under one document key yet (sealed before document keys, or a
 * mix), `rekey` holds them re-encrypted under one, to be stored first.
 * Null when nothing printed is sealed, so the link needs no key.
 */
export async function clientLinkKey(key: VaultKey, doc: SealedDocument): Promise<{ docKey: DocumentKey; rekey: RekeyPayload | null } | null> {
  const buyer = Object.entries(doc.buyer ?? {}) as [BuyerField, string][];
  const sealed = [
    doc.noteAbove,
    doc.noteBelow,
    doc.buyerContactPerson,
    ...doc.items.map((i) => i.description),
    ...buyer.map(([, v]) => v),
    doc.encAmounts,
    ...(doc.itemAmounts ?? []).map((i) => i.encAmounts)
  ].filter(isSealed);
  if (!sealed.length) return null;
  const wraps = new Set(sealed.map(documentKeyWrap));
  // A buyer sealed with the contact (company key) has no document key, so the notes' or items' key wins.
  const docKey = await documentKeyFor(key, { items: sealed.map((description) => ({ description })) });
  if (wraps.size === 1 && wraps.has(docKey.wrap)) return { docKey, rekey: null };
  const reseal = async (value: string | null) => (value && isSealed(value) && documentKeyWrap(value) !== docKey.wrap ? sealWithDocumentKey(docKey, await open(key, value)) : undefined);
  const rekey: RekeyPayload = {
    noteAbove: await reseal(doc.noteAbove),
    noteBelow: await reseal(doc.noteBelow),
    items: (
      await Promise.all(doc.items.map(async (item) => ({ id: item.id, description: await reseal(item.description) })))
    ).filter((i): i is { id: string; description: string } => Boolean(i.description))
  };
  const buyerRekey = Object.fromEntries(
    (await Promise.all(buyer.map(async ([field, value]) => [field, await reseal(value)] as const))).filter(([, v]) => Boolean(v))
  ) as Partial<Record<BuyerField, string>>;
  if (Object.keys(buyerRekey).length) rekey.buyer = buyerRekey;
  const person = await reseal(doc.buyerContactPerson ?? null);
  if (person) rekey.buyerContactPerson = person;
  const totals = await reseal(doc.encAmounts ?? null);
  if (totals) rekey.encAmounts = totals;
  const itemAmounts = (
    await Promise.all((doc.itemAmounts ?? []).map(async (i) => ({ id: i.id, encAmounts: await reseal(i.encAmounts) })))
  ).filter((i): i is { id: string; encAmounts: string } => Boolean(i.encAmounts));
  if (itemAmounts.length) rekey.itemAmounts = itemAmounts;
  return { docKey, rekey };
}
