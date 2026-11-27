import {
  amountTotals,
  decodeDocumentAmounts,
  decodeItemAmounts,
  decodePaymentAmounts,
  encodeDocumentAmounts,
  encodeItemAmounts,
  encodePaymentAmounts,
  generateDocumentKey,
  isSealed,
  open,
  SEALED_ITEM_PLACEHOLDER,
  sealedQrInvoiceString,
  sealedSpaydString,
  sealWithDocumentKey,
  type DocumentAmounts,
  type DocumentKey,
  type ItemAmounts,
  type PaymentAmounts,
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

/**
 * A payment QR (or a standalone QR Faktura) of a sealed document, drawn here
 * once the amount and totals are known (the server drew none). The SPAYD
 * gets QR Faktura inside when the totals are open, as on a plain document.
 */
export async function sealedQrPng(plan: SealedPdfQrPlan, amount: number, totals: DocumentAmounts | null = null): Promise<string | null> {
  const QRCode = (await import('qrcode')).default;
  let text: string;
  if (plan.kind === 'invoice') {
    if (!totals) return null;
    text = sealedQrInvoiceString(plan.params, totals);
  } else if (plan.kind === 'pay_by_square') {
    // The plan is JSON, so its due date travels as YYYY-MM-DD.
    const dueDate = plan.params.dueDate ? new Date(`${plan.params.dueDate}T00:00:00Z`) : undefined;
    text = generatePayBySquareString({ ...plan.params, amount, dueDate });
  } else {
    text = sealedSpaydString(plan.params, amount, totals);
  }
  return QRCode.toDataURL(text, { margin: 1, width: 280, errorCorrectionLevel: 'M' }).catch(() => null);
}

/** One payment of a sealed document, opened with the vault key or the client's link key. */
export async function openPaymentWith(openCipher: (cipher: string) => Promise<string>, cipher: string): Promise<PaymentAmounts> {
  return decodePaymentAmounts(await openCipher(cipher));
}

/** A new payment's sums, sealed under the document's key before they leave the tab. */
export async function sealPayment(docKey: DocumentKey, payment: PaymentAmounts): Promise<string> {
  return sealWithDocumentKey(docKey, encodePaymentAmounts(payment));
}

/** `GET /api/v1/vault/invoices/plain-amounts`: one document whose amounts are still plain. */
export interface PlainAmountsDocument {
  id: string;
  invoiceNumber: string | null;
  reverseCharge: boolean;
  items: ({ id: string } & ItemAmounts)[];
  documentKeyWrap: string | null;
  /** What was paid in plain; it becomes one sealed payment. `full` is a document paid in full. */
  paid: { amount: number; fee: number; receivedHome: number | null; full: boolean } | null;
}

/**
 * The plain paid columns as one payment envelope, when sealing them: a
 * document paid in full carries its total (the plain sum may be older than
 * an edit), a partly paid one what was received. Undefined when nothing
 * was paid, or for fees alone on an unpaid document.
 */
export async function sealCarriedPayment(
  docKey: DocumentKey,
  paid: PlainAmountsDocument['paid'],
  total: number
): Promise<string | undefined> {
  if (!paid) return undefined;
  const amount = paid.full ? total : paid.amount;
  if (!(amount > 0)) return undefined;
  return sealPayment(docKey, { amount, fee: paid.fee, receivedHome: paid.receivedHome });
}

/** For "Zašifrovat částky": one envelope per item and the totals, under the document's key, and what was paid. */
export async function sealPlainAmounts(docKey: DocumentKey, doc: PlainAmountsDocument) {
  const totals = amountTotals(doc.items, { reverseCharge: doc.reverseCharge });
  const encPaid = await sealCarriedPayment(docKey, doc.paid, totals.totalWithVat);
  return {
    id: doc.id,
    encAmounts: await sealWithDocumentKey(docKey, encodeDocumentAmounts(totals)),
    items: await Promise.all(doc.items.map(async (item) => ({ id: item.id, encAmounts: await sealWithDocumentKey(docKey, encodeItemAmounts(item)) }))),
    ...(encPaid ? { encPaid } : {})
  };
}

/** One draft of a bulk run from a sealed template, sealed under its own document key. */
export interface SealedBulkCopy {
  contact_id: string;
  enc_amounts: string;
  note_above?: string | null;
  note_below?: string | null;
  line_items: { description: string; enc_amounts: string }[];
}

/**
 * Bulk invoicing from a template with sealed amounts: the template is opened
 * once here, then every customer's draft gets a fresh document key, so one
 * client link never opens another customer's draft. Texts that were sealed
 * in the template stay sealed; plain ones stay plain.
 */
export async function sealTemplateCopies(
  key: VaultKey,
  template: { noteAbove?: string | null; noteBelow?: string | null; lineItems: (AmountsItem & { description: string })[] },
  contactIds: string[]
): Promise<SealedBulkCopy[]> {
  const openText = async (value: string | null | undefined) => (isSealed(value) ? open(key, value!) : (value ?? null));
  const items = await Promise.all(
    template.lineItems.map(async (item) => ({
      amounts: isSealed(item.encAmounts) ? decodeItemAmounts(await open(key, item.encAmounts!)) : itemOf(item),
      description: (await openText(item.description)) ?? '',
      sealedText: isSealed(item.description)
    }))
  );
  const noteAbove = await openText(template.noteAbove);
  const noteBelow = await openText(template.noteBelow);
  const totals = encodeDocumentAmounts(amountTotals(items.map((i) => i.amounts), { reverseCharge: false }));
  const copies: SealedBulkCopy[] = [];
  for (const contactId of contactIds) {
    const docKey = await generateDocumentKey(key);
    const text = async (value: string | null, sealed: boolean) => (value && sealed ? sealWithDocumentKey(docKey, value) : value);
    copies.push({
      contact_id: contactId,
      enc_amounts: await sealWithDocumentKey(docKey, totals),
      note_above: await text(noteAbove, isSealed(template.noteAbove)),
      note_below: await text(noteBelow, isSealed(template.noteBelow)),
      line_items: await Promise.all(
        items.map(async (item) => ({
          description: (await text(item.description, item.sealedText)) ?? '',
          enc_amounts: await sealWithDocumentKey(docKey, encodeItemAmounts(item.amounts))
        }))
      )
    });
  }
  return copies;
}
