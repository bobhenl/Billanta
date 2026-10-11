import * as schema from "../../drizzle/schema";

type InvoiceLineItem = typeof schema.invoiceLineItems.$inferSelect;

/**
 * Sums an invoice's line items into a single total, including VAT.
 *
 * Deliberately simplistic: `packages/cz-compliance`'s real ISDOC/PDF
 * generator (blueprint §1, §6 step 9) does not exist yet, so this is NOT
 * the eventual source of truth for invoice totals on generated documents —
 * it exists only so the invoice/reminder emails (`EmailService`) can show a
 * real, correctly-summed amount instead of a placeholder. `invoices` itself
 * deliberately has no stored `subtotal`/`vat_total`/`total` column (see the
 * long comment on `get_public_invoice_view` in `drizzle/rls-policies.sql`)
 * — totals are always derived from `invoice_line_items`, here and
 * everywhere else.
 *
 * Numeric Postgres columns come back from `postgres.js`/Drizzle as strings
 * (to avoid silent float-precision loss on the wire), so every input field
 * is parsed with `Number(...)` before arithmetic.
 */
export function computeInvoiceTotal(lineItems: InvoiceLineItem[]): number {
  return lineItems.reduce((total, item) => {
    const quantity = Number(item.quantity);
    const unitPrice = Number(item.unitPrice);
    const vatRate = item.vatRate != null ? Number(item.vatRate) : 0;
    const lineSubtotal = quantity * unitPrice;
    return total + lineSubtotal + lineSubtotal * (vatRate / 100);
  }, 0);
}

/** Formats a computed total for display in email bodies, e.g. "1815.00 CZK". */
export function formatInvoiceAmount(total: number, currency: string): string {
  return `${total.toFixed(2)} ${currency}`;
}
