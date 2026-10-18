/**
 * What the teacher's progress grid shows per student: things done in the
 * practice company since it was handed over (the dataset does not count).
 * The lesson pages (apps/frontend/lib/school-lessons.ts) name the same keys.
 */
export const MILESTONES = [
  "contact_created",
  "invoice_issued",
  "invoice_vat",
  "invoice_foreign_currency",
  "invoice_reverse_charge",
  "proforma_converted",
  "quote_created",
  "credit_note_issued",
  "invoice_paid",
  "bank_matched",
  "expense_recorded",
  "recurring_created",
  "time_logged",
] as const;
export type Milestone = (typeof MILESTONES)[number];

/** One row per milestone, the count since `$1`; runs inside the student company's RLS context. */
export const MILESTONE_SQL = `
WITH since AS (SELECT $1::timestamptz AS at),
home AS (SELECT CASE WHEN address_country = 'SK' THEN 'EUR' ELSE 'CZK' END AS currency FROM tenants LIMIT 1),
issued AS (
  SELECT i.* FROM invoices i, since
  WHERE i.issued_at > since.at AND i.status NOT IN ('draft', 'pending_review')
)
SELECT
  (SELECT count(*) FROM contacts c, since WHERE c.created_at > since.at) AS contact_created,
  (SELECT count(*) FROM issued WHERE document_type = 'invoice') AS invoice_issued,
  (SELECT count(*) FROM issued i WHERE i.document_type = 'invoice' AND NOT i.reverse_charge
     AND EXISTS (SELECT 1 FROM invoice_line_items l WHERE l.invoice_id = i.id AND l.vat_rate > 0)) AS invoice_vat,
  (SELECT count(*) FROM issued, home WHERE document_type = 'invoice' AND issued.currency <> home.currency) AS invoice_foreign_currency,
  (SELECT count(*) FROM issued WHERE document_type = 'invoice' AND reverse_charge) AS invoice_reverse_charge,
  (SELECT count(*) FROM issued i JOIN invoices p ON p.id = i.related_invoice_id
     WHERE i.document_type = 'invoice' AND p.document_type = 'proforma') AS proforma_converted,
  (SELECT count(*) FROM invoices q, since WHERE q.document_type = 'quote' AND q.created_at > since.at) AS quote_created,
  (SELECT count(*) FROM issued WHERE document_type = 'credit_note') AS credit_note_issued,
  (SELECT count(*) FROM invoices i, since WHERE i.paid_at > since.at) AS invoice_paid,
  (SELECT count(*) FROM bank_transactions b, since WHERE b.status = 'matched'
     AND (b.created_at > since.at OR EXISTS (SELECT 1 FROM invoices i WHERE i.id = b.matched_invoice_id AND i.created_at > since.at))) AS bank_matched,
  (SELECT count(*) FROM expenses e, since WHERE e.created_at > since.at) AS expense_recorded,
  (SELECT count(*) FROM recurring_invoice_templates r, since WHERE r.created_at > since.at) AS recurring_created,
  (SELECT count(*) FROM time_entries t, since WHERE t.created_at > since.at) AS time_logged
`;

export type MilestoneCounts = Record<Milestone, number>;

/** postgres.js returns count(*) as a string. */
export function toMilestoneCounts(row: Record<string, unknown> | undefined): MilestoneCounts {
  return Object.fromEntries(MILESTONES.map((m) => [m, Number(row?.[m] ?? 0) || 0])) as MilestoneCounts;
}
