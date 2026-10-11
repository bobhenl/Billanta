import * as schema from "../../drizzle/schema";

type InvoiceLineItem = Pick<
  typeof schema.invoiceLineItems.$inferSelect,
  "quantity" | "unitPrice" | "vatRate"
> & { discountPercent?: string | null };

/** A line's amount without VAT: quantity × unit price, minus its discount. */
export function lineBase(item: InvoiceLineItem): number {
  const discount = item.discountPercent != null ? Number(item.discountPercent) : 0;
  return Number(item.quantity) * Number(item.unitPrice) * (1 - discount / 100);
}

/**
 * Rounds to whole hellers/cents. Sums are rounded once per VAT bucket so
 * the PDF, ISDOC and email always show the same numbers.
 */
export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

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
export function computeInvoiceTotal(lineItems: InvoiceLineItem[], options: { reverseCharge?: boolean } = {}): number {
  return computeVatBreakdown(lineItems, options).totalWithVat;
}

/** Formats a computed total for display in email bodies, e.g. "1815.00 CZK". */
export function formatInvoiceAmount(total: number, currency: string): string {
  return `${total.toFixed(2)} ${currency}`;
}

/** One VAT-rate bucket of an invoice's totals, keyed by the rate itself (not a category label — see `vatRateToIsdocCategory` in `isdoc-input.builder.ts` for the ISDOC-specific category mapping). */
export interface VatBreakdownEntry {
  vatRatePercent: number;
  totalWithoutVat: number;
  vatAmount: number;
  totalWithVat: number;
}

export interface InvoiceVatBreakdown {
  totalWithoutVat: number;
  totalVat: number;
  totalWithVat: number;
  /** One entry per distinct VAT rate present on the invoice's line items, sorted ascending by rate. */
  byRate: VatBreakdownEntry[];
}

/**
 * Groups an invoice's line items by VAT rate and sums each group — the
 * "VAT recapitulation" both the PDF (`InvoicePdfService`) and ISDOC XML
 * (`isdoc-input.builder.ts`) need, plus the grand totals. A missing
 * `vatRate` (still possible on an AI-drafted line item the reviewer hasn't
 * filled in yet — see `invoice_line_items.vatRate`'s doc comment) is
 * treated as 0%, same as `computeInvoiceTotal` above; callers issuing an
 * invoice should have already required every line item to carry a rate
 * (see `InvoicesService.issue`) before relying on this for a legal document.
 */
export function computeVatBreakdown(
  lineItems: InvoiceLineItem[],
  options: { reverseCharge?: boolean } = {},
): InvoiceVatBreakdown {
  const byRateMap = new Map<number, VatBreakdownEntry>();

  for (const item of lineItems) {
    // Reverse charge: the customer accounts for the VAT, so none is charged here.
    const vatRatePercent = options.reverseCharge ? 0 : item.vatRate != null ? Number(item.vatRate) : 0;
    const lineWithoutVat = lineBase(item);
    const lineVat = lineWithoutVat * (vatRatePercent / 100);

    const existing = byRateMap.get(vatRatePercent);
    if (existing) {
      existing.totalWithoutVat += lineWithoutVat;
      existing.vatAmount += lineVat;
      existing.totalWithVat += lineWithoutVat + lineVat;
    } else {
      byRateMap.set(vatRatePercent, {
        vatRatePercent,
        totalWithoutVat: lineWithoutVat,
        vatAmount: lineVat,
        totalWithVat: lineWithoutVat + lineVat,
      });
    }
  }

  const byRate = [...byRateMap.values()]
    .sort((a, b) => a.vatRatePercent - b.vatRatePercent)
    .map((entry) => {
      const totalWithoutVat = round2(entry.totalWithoutVat);
      const vatAmount = round2(entry.vatAmount);
      return { ...entry, totalWithoutVat, vatAmount, totalWithVat: round2(totalWithoutVat + vatAmount) };
    });

  const totals = byRate.reduce(
    (acc, entry) => ({
      totalWithoutVat: acc.totalWithoutVat + entry.totalWithoutVat,
      totalVat: acc.totalVat + entry.vatAmount,
      totalWithVat: acc.totalWithVat + entry.totalWithVat,
    }),
    { totalWithoutVat: 0, totalVat: 0, totalWithVat: 0 },
  );

  return {
    totalWithoutVat: round2(totals.totalWithoutVat),
    totalVat: round2(totals.totalVat),
    totalWithVat: round2(totals.totalWithVat),
    byRate,
  };
}
