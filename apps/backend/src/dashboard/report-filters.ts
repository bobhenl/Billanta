import { z } from "zod";

/** Statuses the report filter offers; "unpaid" = issued, not paid yet; "overdue" = unpaid past due. */
export const REPORT_STATUSES = ["paid", "unpaid", "overdue", "cancelled"] as const;
export const REPORT_DOC_TYPES = ["invoice", "proforma", "credit_note"] as const;

/**
 * Optional filters shared by the period report and the accountant export.
 * Everything is validated here, so services only ever see clean values;
 * the contact id is matched inside the tenant's RLS-scoped connection, so
 * another company's id simply matches nothing.
 */
export const reportFiltersSchema = z
  .object({
    currency: z
      .string()
      .regex(/^[A-Za-z]{3}$/)
      .transform((s) => s.toUpperCase()),
    language: z
      .string()
      .regex(/^[A-Za-z]{2}$/)
      .transform((s) => s.toLowerCase()),
    contactId: z.string().uuid(),
    documentType: z.enum(REPORT_DOC_TYPES),
    status: z.enum(REPORT_STATUSES),
  })
  .partial();

export type ReportFilters = z.infer<typeof reportFiltersSchema>;

/** Picks the filter keys out of a raw query; empty strings mean "no filter". Throws ZodError on bad input. */
export function parseReportFilters(query: Record<string, unknown>): ReportFilters {
  const raw: Record<string, unknown> = {};
  for (const key of ["currency", "language", "contactId", "documentType", "status"]) {
    const v = query[key];
    // Arrays (?status=a&status=b) and other non-strings fail validation below.
    if (v != null && v !== "") raw[key] = v;
  }
  return reportFiltersSchema.parse(raw);
}

/** What a document needs for the filters to judge it. */
export interface FilterableDoc {
  documentType: string;
  status: string;
  currency: string;
  language: string;
  contactId: string | null;
  dueDate: Date | null;
}

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

/** Same rule as `isOverdue` in invoices.service: unpaid and due before today. */
export function isOverdueDoc(doc: Pick<FilterableDoc, "status" | "dueDate" | "documentType">, today: Date): boolean {
  return doc.status === "issued" && doc.documentType !== "quote" && doc.dueDate != null && doc.dueDate < startOfDay(today);
}

export function matchesFilters(doc: FilterableDoc, filters: ReportFilters, today = new Date()): boolean {
  if (filters.currency && doc.currency !== filters.currency) return false;
  if (filters.language && doc.language !== filters.language) return false;
  if (filters.contactId && doc.contactId !== filters.contactId) return false;
  if (filters.documentType && doc.documentType !== filters.documentType) return false;
  switch (filters.status) {
    case "paid":
      return doc.status === "paid";
    case "unpaid":
      return doc.status === "issued";
    case "overdue":
      return isOverdueDoc(doc, today);
    case "cancelled":
      return doc.status === "cancelled";
    default:
      return true;
  }
}

/** True when a filter narrows the documents themselves (expenses only follow the currency). */
export function hasDocumentFilters(filters: ReportFilters): boolean {
  return !!(filters.language || filters.contactId || filters.documentType || filters.status);
}
