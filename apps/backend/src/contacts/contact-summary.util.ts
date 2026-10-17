import { computeVatBreakdown } from "../invoices/invoice-total.util";

/**
 * One row of the contact-summary aggregate query: an invoice of the contact
 * with its line items already summed per VAT rate in SQL (one row per
 * invoice × rate; `vatRate`/`base` are null for an invoice with no items).
 */
export interface ContactSummaryBucket {
  invoiceId: string;
  currency: string;
  status: string;
  documentType: string;
  dueDate: Date | string | null;
  issueDate: Date | string | null;
  amountPaid: string;
  reverseCharge: boolean;
  vatRate: string | null;
  base: string | null;
}

export interface ContactCurrencySummary {
  currency: string;
  invoiceCount: number;
  invoiced: number;
  unpaid: number;
  overdue: number;
}

export interface ContactSummary {
  invoiceCount: number;
  overdueCount: number;
  lastInvoiceDate: string | null;
  byCurrency: ContactCurrencySummary[];
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const isoDay = (d: Date | string) => (typeof d === "string" ? d.slice(0, 10) : d.toISOString().slice(0, 10));

/**
 * Folds the per-rate buckets into per-currency totals. Totals go through
 * `computeVatBreakdown` (one pseudo line per rate bucket), so they round the
 * same way as the invoice list. Only issued/paid invoices and credit notes
 * count; "unpaid" is the rest of an issued one, "overdue" the part past due.
 */
export function summarizeContactInvoices(buckets: ContactSummaryBucket[], today: Date = new Date()): ContactSummary {
  const startOfToday = new Date(today);
  startOfToday.setHours(0, 0, 0, 0);

  const invoices = new Map<string, { head: ContactSummaryBucket; lines: { quantity: string; unitPrice: string; vatRate: string | null }[] }>();
  for (const b of buckets) {
    const entry = invoices.get(b.invoiceId) ?? { head: b, lines: [] };
    if (b.base !== null) entry.lines.push({ quantity: "1", unitPrice: b.base, vatRate: b.vatRate });
    invoices.set(b.invoiceId, entry);
  }

  const byCurrency = new Map<string, ContactCurrencySummary>();
  let overdueCount = 0;
  let lastInvoiceDate: string | null = null;
  for (const { head, lines } of invoices.values()) {
    const total = computeVatBreakdown(lines, { reverseCharge: head.reverseCharge }).totalWithVat;
    const row = byCurrency.get(head.currency) ?? { currency: head.currency, invoiceCount: 0, invoiced: 0, unpaid: 0, overdue: 0 };
    row.invoiceCount += 1;
    row.invoiced += total;
    if (head.status === "issued") {
      const open = Math.max(0, total - Number(head.amountPaid));
      row.unpaid += open;
      if (open > 0 && head.dueDate != null && new Date(head.dueDate) < startOfToday) {
        row.overdue += open;
        overdueCount += 1;
      }
    }
    byCurrency.set(head.currency, row);
    if (head.issueDate != null) {
      const day = isoDay(head.issueDate);
      if (lastInvoiceDate === null || day > lastInvoiceDate) lastInvoiceDate = day;
    }
  }

  return {
    invoiceCount: invoices.size,
    overdueCount,
    lastInvoiceDate,
    byCurrency: [...byCurrency.values()]
      .map((r) => ({ ...r, invoiced: round2(r.invoiced), unpaid: round2(r.unpaid), overdue: round2(r.overdue) }))
      .sort((a, b) => b.invoiced - a.invoiced || a.currency.localeCompare(b.currency)),
  };
}
