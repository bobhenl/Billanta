import {
  amountTotals,
  decodeDocumentAmounts,
  decodeItemAmounts,
  encodeDocumentAmounts,
  encodeItemAmounts,
  generateSpaydString,
  isSealed,
  open,
  SEALED_ITEM_PLACEHOLDER,
  sealWithDocumentKey,
  type DocumentAmounts,
  type DocumentKey,
  type ItemAmounts,
  type SealedPdfQrPlan,
  type VaultKey
} from '@faktur/cz-compliance';
import { generatePayBySquareString } from '@faktur/cz-compliance/pay-by-square';
import type { EnabledVault } from './types';

/*
 * Browser side of the "amounts" category: each item's quantity, unit price,
 * VAT rate and discount become one envelope, the document's totals another,
 * all under the document's key (so the client link opens them). The plain
 * columns get the placeholder, so the server only ever sums zeros.
 */

/** The category is on: documents get their amounts encrypted. */
export const amountsConfidential = (vault: EnabledVault | null) => Boolean(vault?.categories.includes('amounts'));

/** New and edited documents get encrypted amounts: the category is on and the plan still allows it. */
export const sealsAmounts = (vault: EnabledVault | null) => amountsConfidential(vault) && vault?.planAllowed !== false;

type AmountsItem = { quantity: number; unitPrice: number; vatRate: number | null; discountPercent?: number; encAmounts?: string | null };

/** The document's amounts are encrypted (its own envelope, or any item's). */
export function amountsAreSealed(draft: { encAmounts?: string | null; items?: AmountsItem[] | null } | null | undefined): boolean {
  if (!draft) return false;
  return isSealed(draft.encAmounts) || (draft.items ?? []).some((i) => isSealed(i.encAmounts));
}

const itemOf = (i: AmountsItem): ItemAmounts => ({
  quantity: Number(i.quantity),
  unitPrice: Number(i.unitPrice),
  vatRate: i.vatRate == null ? null : Number(i.vatRate),
  discountPercent: Number(i.discountPercent ?? 0)
});

/**
 * The items with their real numbers sealed and the placeholder in the plain
 * fields, and the totals envelope. Called right before the save leaves the tab.
 */
export async function sealAmounts<T extends { encAmounts?: string | null; items: I[] }, I extends AmountsItem>(
  docKey: DocumentKey,
  draft: T,
  options: { reverseCharge: boolean }
): Promise<T> {
  const plain = draft.items.map(itemOf);
  const items = await Promise.all(
    draft.items.map(async (item, n) => ({
      ...item,
      ...SEALED_ITEM_PLACEHOLDER,
      encAmounts: await sealWithDocumentKey(docKey, encodeItemAmounts(plain[n]!))
    }))
  );
  const encAmounts = await sealWithDocumentKey(docKey, encodeDocumentAmounts(amountTotals(plain, options)));
  return { ...draft, items, encAmounts };
}

/** The editor's starting point with the real numbers back in the plain fields. */
export async function openAmounts<T extends { encAmounts?: string | null; items?: I[] | null }, I extends AmountsItem>(key: VaultKey, draft: T): Promise<T> {
  if (!draft.items || !amountsAreSealed(draft)) return draft;
  const items = await Promise.all(
    draft.items.map(async (item) => (isSealed(item.encAmounts) ? { ...item, ...decodeItemAmounts(await open(key, item.encAmounts!)), encAmounts: null } : item))
  );
  return { ...draft, items, encAmounts: null };
}

export async function openItemAmounts(key: VaultKey, cipher: string): Promise<ItemAmounts> {
  return decodeItemAmounts(await open(key, cipher));
}

export async function openDocumentAmounts(key: VaultKey, cipher: string): Promise<DocumentAmounts> {
  return decodeDocumentAmounts(await open(key, cipher));
}

/** A payment QR of a sealed document, drawn here once the amount is known (the server drew none). */
export async function sealedQrPng(plan: SealedPdfQrPlan, amount: number): Promise<string | null> {
  const QRCode = (await import('qrcode')).default;
  // The plan is JSON, so its due date travels as YYYY-MM-DD.
  const dueDate = plan.params.dueDate ? new Date(`${plan.params.dueDate}T00:00:00Z`) : undefined;
  const text =
    plan.kind === 'pay_by_square'
      ? generatePayBySquareString({ ...plan.params, amount, dueDate })
      : generateSpaydString({ ...plan.params, amount, dueDate });
  return QRCode.toDataURL(text, { margin: 1, width: 280, errorCorrectionLevel: 'M' }).catch(() => null);
}

/** `GET /api/v1/vault/invoices/plain-amounts`: one document whose amounts are still plain. */
export interface PlainAmountsDocument {
  id: string;
  invoiceNumber: string | null;
  reverseCharge: boolean;
  items: ({ id: string } & ItemAmounts)[];
  documentKeyWrap: string | null;
}

/** For "Zašifrovat částky": one envelope per item and the totals, under the document's key. */
export async function sealPlainAmounts(docKey: DocumentKey, doc: PlainAmountsDocument) {
  return {
    id: doc.id,
    encAmounts: await sealWithDocumentKey(docKey, encodeDocumentAmounts(amountTotals(doc.items, { reverseCharge: doc.reverseCharge }))),
    items: await Promise.all(doc.items.map(async (item) => ({ id: item.id, encAmounts: await sealWithDocumentKey(docKey, encodeItemAmounts(item)) })))
  };
}
