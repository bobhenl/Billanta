import { lockBlocks } from "../invoices/invoice-lock";
import { computeVatBreakdown } from "../invoices/invoice-total.util";
import { applyBuyerSnapshot } from "../invoices/party-snapshot";
import type { AuthenticatedUser } from "../tenancy/tenant-context.middleware";
import type * as schema from "../../drizzle/schema";

type InvoiceRow = typeof schema.invoices.$inferSelect;
type LineItemRow = typeof schema.invoiceLineItems.$inferSelect;

/**
 * One document as the browser needs it to search, suggest from and export
 * its encrypted texts after unlock. The texts go out exactly as stored:
 * envelopes stay envelopes, the server opens nothing.
 */
export function vaultDocumentView(
  invoice: InvoiceRow,
  contact: { legalName: string | null; ico: string | null } | null,
  items: LineItemRow[],
) {
  const buyer = contact ? applyBuyerSnapshot(contact, invoice.buyerSnapshot) : null;
  const totals = computeVatBreakdown(items, { reverseCharge: invoice.reverseCharge });
  return {
    id: invoice.id,
    documentType: invoice.documentType,
    invoiceNumber: invoice.invoiceNumber,
    status: invoice.status,
    issueDate: invoice.issueDate,
    taxableSupplyDate: invoice.taxableSupplyDate,
    dueDate: invoice.dueDate,
    paidAt: invoice.paidAt,
    currency: invoice.currency,
    variableSymbol: invoice.variableSymbol,
    contactName: buyer?.legalName ?? null,
    contactIco: buyer?.ico ?? null,
    noteAbove: invoice.noteAbove,
    noteBelow: invoice.noteBelow,
    internalNote: invoice.internalNote,
    totalWithoutVat: totals.totalWithoutVat,
    totalVat: totals.totalVat,
    total: totals.totalWithVat,
    createdAt: invoice.createdAt,
    items: [...items]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((l) => ({
        description: l.description,
        code: l.code,
        quantity: Number(l.quantity),
        unit: l.unit,
        unitPrice: Number(l.unitPrice),
        vatRate: l.vatRate == null ? null : Number(l.vatRate),
        discountPercent: Number(l.discountPercent),
        createdAt: l.createdAt,
      })),
  };
}

/**
 * The page of documents the caller may open: a locked document stays out
 * until its re-auth, same as on its detail (`lockBlocks`). `next` is the last
 * id of the full page, so paging continues past skipped ones.
 */
export function openablePage<T extends { id: string; lockedAt: Date | null }>(rows: T[], limit: number, user: Pick<AuthenticatedUser, "apiKey" | "role" | "unlocked">) {
  const page = rows.slice(0, limit);
  const open = page.filter((r) => !lockBlocks(r.lockedAt, user));
  return { open, skippedLocked: page.length - open.length, next: rows.length > limit ? page[page.length - 1]!.id : null };
}
