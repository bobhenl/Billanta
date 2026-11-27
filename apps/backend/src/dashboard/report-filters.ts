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

// Shared with the browser's rerun of the period report (cz-compliance report-stats).
export { hasDocumentFilters, isOverdueDoc, matchesFilters, type FilterableDoc } from "@faktur/cz-compliance";
