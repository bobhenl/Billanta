import type * as schema from "../../drizzle/schema";
import { mapBitfakturaInvoices, type BitfakturaInvoice } from "./bitfaktura-import";

type InvoiceRow = typeof schema.invoices.$inferSelect;

/** What the backfill reads of an already imported invoice. */
export type BackfillRow = Pick<
  InvoiceRow,
  | "id"
  | "invoiceNumber"
  | "source"
  | "variableSymbol"
  | "noteBelow"
  | "internalNote"
  | "orderNumber"
  | "issuePlace"
  | "issuedByName"
  | "reverseCharge"
  | "exchangeRate"
  | "exchangeRateMode"
  | "exchangeRateDate"
  | "sellerSnapshot"
  | "buyerSnapshot"
>;

/** Only these columns are ever written. Amounts, lines, numbers, dates and status are not among them. */
export type BackfillPatch = Partial<
  Pick<
    InvoiceRow,
    | "variableSymbol"
    | "noteBelow"
    | "internalNote"
    | "orderNumber"
    | "issuePlace"
    | "issuedByName"
    | "reverseCharge"
    | "exchangeRateMode"
    | "exchangeRateDate"
    | "sellerSnapshot"
    | "buyerSnapshot"
  >
>;

export interface BackfillPlan {
  id: string;
  invoiceNumber: string;
  patch: BackfillPatch;
}

const empty = (v: unknown) => v === null || v === undefined || (typeof v === "string" && !v.trim());

/**
 * Snapshot keys the stored one lacks, taken from the source. A key the stored
 * snapshot has (even as null, "known empty") is kept, and so are its
 * `capturedAt` / `source`. Null when there is nothing to add.
 */
function fillSnapshot(stored: unknown, fresh: Record<string, unknown> | null | undefined): Record<string, unknown> | null {
  if (!fresh) return null;
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return fresh;
  const current = stored as Record<string, unknown>;
  const added = Object.entries(fresh).filter(([key, value]) => key !== "capturedAt" && key !== "source" && !(key in current) && !empty(value));
  return added.length ? { ...current, ...Object.fromEntries(added) } : null;
}

/**
 * Fills in what earlier BitFaktura imports left out (notes, order number,
 * VS, reverse charge, rate origin, party snapshots), for invoices already in
 * the database. Pure: it only says what to write.
 *
 * Rows are matched by invoice number (unique per company), and only rows
 * with `source = 'import'`. A field is written only while it is still empty
 * in our row, so anything a person has edited since stays as it is.
 * Reverse charge is switched on only where every line is without VAT, so the
 * invoice totals cannot change.
 */
export function planBitfakturaBackfill(source: BitfakturaInvoice[], rows: BackfillRow[], capturedAt: Date = new Date()): BackfillPlan[] {
  const byNumber = new Map(rows.filter((r) => r.source === "import" && r.invoiceNumber).map((r) => [r.invoiceNumber!, r]));
  const plans: BackfillPlan[] = [];
  for (const inv of mapBitfakturaInvoices(source, capturedAt).invoices) {
    const row = byNumber.get(inv.invoiceNumber);
    if (!row) continue;
    const patch: BackfillPatch = {};
    const fill = <K extends "variableSymbol" | "noteBelow" | "internalNote" | "orderNumber" | "issuePlace" | "issuedByName">(key: K, value: string | null | undefined) => {
      if (empty(row[key]) && !empty(value)) patch[key] = value!;
    };
    fill("variableSymbol", inv.variableSymbol);
    fill("noteBelow", inv.note);
    fill("internalNote", inv.internalNote);
    fill("orderNumber", inv.orderNumber);
    fill("issuePlace", inv.issuePlace);
    fill("issuedByName", inv.issuedByName);
    if (inv.reverseCharge && !row.reverseCharge && inv.lines.every((l) => l.vatRate === 0)) patch.reverseCharge = true;
    // The rate's origin only describes the rate we hold if it is the same rate.
    const sameRate = row.exchangeRate !== null && inv.exchangeRate != null && Math.abs(Number(row.exchangeRate) - inv.exchangeRate) < 1e-6;
    if (sameRate && row.exchangeRateMode === null && inv.exchangeRateMode) {
      patch.exchangeRateMode = inv.exchangeRateMode;
      if (row.exchangeRateDate === null && inv.exchangeRateDate) patch.exchangeRateDate = inv.exchangeRateDate;
    }
    const seller = fillSnapshot(row.sellerSnapshot, inv.sellerSnapshot as Record<string, unknown> | null | undefined);
    if (seller) patch.sellerSnapshot = seller;
    const buyer = fillSnapshot(row.buyerSnapshot, inv.buyerSnapshot as Record<string, unknown> | null | undefined);
    if (buyer) patch.buyerSnapshot = buyer;
    if (Object.keys(patch).length > 0) plans.push({ id: row.id, invoiceNumber: inv.invoiceNumber, patch });
  }
  return plans;
}
