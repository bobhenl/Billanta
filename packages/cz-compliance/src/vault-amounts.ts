import type { IsdocInvoiceInput, VatRateType } from './isdoc-generator.js';
import { isSealed } from './vault/confidential.js';

/**
 * The "amounts" category of Confidential mode. The browser seals each line
 * item's quantity, unit price, VAT rate and discount as one envelope, and the
 * document's totals as another, all under the document's key. The server
 * keeps placeholder values in the plain columns (so every server sum of a
 * sealed document is 0, never a real number) and the browser computes the
 * real totals after unlock with the same rounding as the server.
 *
 * Pure helpers only: sealing itself is `sealWithDocumentKey` in vault/.
 */

export interface ItemAmounts {
  quantity: number;
  unitPrice: number;
  /** Null: not filled in yet (an AI draft), counted as 0 % like on the server. */
  vatRate: number | null;
  discountPercent: number;
}

export interface AmountsRate {
  vatRatePercent: number;
  totalWithoutVat: number;
  vatAmount: number;
  totalWithVat: number;
}

export interface DocumentAmounts {
  totalWithoutVat: number;
  totalVat: number;
  totalWithVat: number;
  byRate: AmountsRate[];
}

/**
 * What a sealed line item stores in its plain columns. Quantity 1 because
 * the API refuses a zero quantity; price 0 so no server sum ever carries a
 * real amount. The server refuses anything else next to an envelope.
 */
export const SEALED_ITEM_PLACEHOLDER = { quantity: 1, unitPrice: 0, vatRate: null, discountPercent: 0 } as const;

/** The plain columns hold the placeholder (values as Postgres returns them, strings). */
export function isItemPlaceholder(item: { quantity: unknown; unitPrice: unknown; vatRate?: unknown; discountPercent?: unknown }): boolean {
  return (
    Number(item.quantity) === SEALED_ITEM_PLACEHOLDER.quantity &&
    Number(item.unitPrice) === 0 &&
    item.vatRate == null &&
    Number(item.discountPercent ?? 0) === 0
  );
}

function finite(value: unknown, field: string): number {
  const n = typeof value === 'string' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isFinite(n)) throw new Error(`amounts_${field}`);
  return n;
}

export function encodeItemAmounts(item: ItemAmounts): string {
  return JSON.stringify({
    quantity: finite(item.quantity, 'quantity'),
    unitPrice: finite(item.unitPrice, 'unit_price'),
    vatRate: item.vatRate == null ? null : finite(item.vatRate, 'vat_rate'),
    discountPercent: finite(item.discountPercent ?? 0, 'discount'),
  });
}

/** Throws on anything that is not an item's amounts, so a wrong envelope never prints as 0. */
export function decodeItemAmounts(plain: string): ItemAmounts {
  const raw = JSON.parse(plain) as Record<string, unknown>;
  if (!raw || typeof raw !== 'object') throw new Error('amounts_shape');
  return {
    quantity: finite(raw.quantity, 'quantity'),
    unitPrice: finite(raw.unitPrice, 'unit_price'),
    vatRate: raw.vatRate == null ? null : finite(raw.vatRate, 'vat_rate'),
    discountPercent: finite(raw.discountPercent ?? 0, 'discount'),
  };
}

export function encodeDocumentAmounts(amounts: DocumentAmounts): string {
  return JSON.stringify(amounts);
}

export function decodeDocumentAmounts(plain: string): DocumentAmounts {
  const raw = JSON.parse(plain) as Record<string, unknown>;
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.byRate)) throw new Error('amounts_shape');
  return {
    totalWithoutVat: finite(raw.totalWithoutVat, 'total'),
    totalVat: finite(raw.totalVat, 'total'),
    totalWithVat: finite(raw.totalWithVat, 'total'),
    byRate: (raw.byRate as Record<string, unknown>[]).map((r) => ({
      vatRatePercent: finite(r.vatRatePercent, 'rate'),
      totalWithoutVat: finite(r.totalWithoutVat, 'total'),
      vatAmount: finite(r.vatAmount, 'total'),
      totalWithVat: finite(r.totalWithVat, 'total'),
    })),
  };
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** A line's amount without VAT: quantity × unit price, minus its discount. */
export function itemBase(item: ItemAmounts): number {
  return item.quantity * item.unitPrice * (1 - (item.discountPercent ?? 0) / 100);
}

/**
 * The VAT recapitulation of opened items. Same algorithm as the backend's
 * `computeVatBreakdown` (one rounding per VAT bucket), so a document sealed
 * later shows exactly the totals it showed while plain.
 */
export function amountTotals(items: ItemAmounts[], options: { reverseCharge?: boolean } = {}): DocumentAmounts {
  const buckets = new Map<number, { base: number; vat: number }>();
  for (const item of items) {
    // Reverse charge: the customer accounts for the VAT (§ 92a zákona o DPH).
    const rate = options.reverseCharge ? 0 : (item.vatRate ?? 0);
    const base = itemBase(item);
    const b = buckets.get(rate) ?? { base: 0, vat: 0 };
    b.base += base;
    b.vat += base * (rate / 100);
    buckets.set(rate, b);
  }
  const byRate = [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([vatRatePercent, b]) => {
      const totalWithoutVat = round2(b.base);
      const vatAmount = round2(b.vat);
      return { vatRatePercent, totalWithoutVat, vatAmount, totalWithVat: round2(totalWithoutVat + vatAmount) };
    });
  const sum = (pick: (r: AmountsRate) => number) => round2(byRate.reduce((acc, r) => acc + pick(r), 0));
  return {
    totalWithoutVat: sum((r) => r.totalWithoutVat),
    totalVat: sum((r) => r.vatAmount),
    totalWithVat: sum((r) => r.totalWithVat),
    byRate,
  };
}

type TotalField = 'totalWithVat' | 'totalWithoutVat' | 'totalVat';

/**
 * A server sum plus the sealed documents' opened totals (keyed by their
 * envelope). `missing` counts the sealed ones not opened (locked, or under
 * another key), so a caller can say the sum is short instead of printing it
 * as complete. Values that are not envelopes are ignored: they are already
 * in the plain part.
 */
export function sumWithOpened(
  plain: number,
  sealed: (string | null | undefined)[],
  opened: ReadonlyMap<string, DocumentAmounts> | null,
  field: TotalField = 'totalWithVat',
): { sum: number; missing: number } {
  let sum = plain;
  let missing = 0;
  for (const cipher of sealed) {
    if (!isSealed(cipher)) continue;
    const totals = opened?.get(cipher);
    if (totals) sum += totals[field];
    else missing++;
  }
  return { sum: round2(sum), missing };
}

/** Quantities on printed documents: up to three decimals, Czech grouping. */
export function formatPdfNumber(value: number): string {
  return value.toLocaleString('cs-CZ', { maximumFractionDigits: 3 });
}

/** Amounts on printed documents: two decimals and the currency code. */
export function formatPdfAmount(value: number, currency: string): string {
  return `${value.toLocaleString('cs-CZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}

/** The ISDOC VAT category of a rate, as the backend's `isdoc-input.builder.ts` maps it. */
function vatCategory(percent: number): VatRateType {
  if (percent === 0) return 'zero';
  if (percent === 12) return 'reduced';
  return 'base';
}

/**
 * A credit note of a sealed invoice: the same items with negated quantities
 * (as the server does for a plain one) and their totals, ready to be sealed
 * again under the invoice's document key.
 */
export function creditNoteAmounts(items: ItemAmounts[], options: { reverseCharge?: boolean } = {}): { items: ItemAmounts[]; totals: DocumentAmounts } {
  const negated = items.map((i) => ({ ...i, quantity: -i.quantity }));
  return { items: negated, totals: amountTotals(negated, options) };
}

/**
 * The ISDOC / UBL input of a sealed document with the real amounts from the
 * opened items (the server built it with the placeholders). Same rules as
 * the server's builder: a discount goes into the unit price, reverse charge
 * means 0 %. `depositIsTotal`: the final invoice of a paid proforma, whose
 * paid deposits (ISDOC) or prepaid amount (UBL) is its whole total.
 */
export function fillSealedIsdocAmounts(
  input: IsdocInvoiceInput,
  items: ItemAmounts[],
  options: { reverseCharge?: boolean; depositIsTotal?: boolean } = {},
): IsdocInvoiceInput {
  if (items.length !== input.lineItems.length) throw new Error('amounts_mismatch');
  const totals = amountTotals(items, options);
  return {
    ...input,
    lineItems: input.lineItems.map((line, n) => {
      const i = items[n]!;
      const vatRatePercent = options.reverseCharge ? 0 : (i.vatRate ?? 0);
      return {
        ...line,
        quantity: i.quantity,
        unitPriceWithoutVat: i.unitPrice * (1 - (i.discountPercent ?? 0) / 100),
        vatRate: vatCategory(vatRatePercent),
        vatRatePercent,
      };
    }),
    totals: {
      ...input.totals,
      ...(options.depositIsTotal ? { paidDepositsAmount: totals.totalWithVat } : {}),
      totalWithoutVat: totals.totalWithoutVat,
      totalVat: totals.totalVat,
      totalWithVat: totals.totalWithVat,
      vatRecapitulation: totals.byRate.map((r) => ({
        vatRate: vatCategory(r.vatRatePercent),
        vatRatePercent: r.vatRatePercent,
        totalWithoutVat: r.totalWithoutVat,
        vatAmount: r.vatAmount,
        totalWithVat: r.totalWithVat,
      })),
    },
  };
}
