import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "../../drizzle/schema";

type TenantDb = PostgresJsDatabase<typeof schema>;

/**
 * Formats a sequential invoice number as `{year}-{sequence, 4-digit
 * zero-padded}`, e.g. `2026-0001`. This matches the format the frontend's
 * invoice list page already hard-codes in its placeholder data (see
 * `apps/frontend/app/[locale]/(dashboard)/invoices/page.tsx`'s
 * `MOCK_INVOICES`, e.g. `"2026-0001"`, `"2025-0098"`) — real issued
 * invoices need to sort/display/scan identically to what that page (and any
 * screenshot/mock built against it) already assumes. `invoices.invoiceNumber`
 * is `varchar(32)`, comfortably fitting this format even for a tenant that
 * somehow issues 5+ digit sequences in one year.
 */
export function formatInvoiceNumber(year: number, sequence: number, series = ""): string {
  return `${series}${year}-${String(sequence).padStart(4, "0")}`;
}

export type DocumentType = (typeof schema.documentTypeEnum.enumValues)[number];

/**
 * Each document type has its own number series, so a proforma or a credit
 * note never takes a number from the invoice sequence (CZ law wants tax
 * documents numbered in one unbroken row): invoices `2026-0001`, proformas
 * `ZF2026-0001`, credit notes `OD2026-0001`, quotes `NA2026-0001`.
 */
export const DOCUMENT_SERIES: Record<DocumentType, string> = {
  invoice: "",
  proforma: "ZF",
  credit_note: "OD",
  quote: "NA",
};

/**
 * Leading digit added to a non-invoice variable symbol so a proforma's or
 * credit note's VS never equals an invoice's (the bank matcher pairs
 * payments by VS). Quotes are not paid, so they get none.
 */
const VS_PREFIX: Record<DocumentType, string | null> = {
  invoice: "",
  proforma: "1",
  credit_note: "2",
  quote: null,
};

export function variableSymbolFor(documentType: DocumentType, invoiceNumber: string): string | null {
  const prefix = VS_PREFIX[documentType];
  return prefix == null ? null : `${prefix}${deriveVariableSymbol(invoiceNumber)}`.slice(0, 10);
}

/**
 * Atomically allocates the next sequential invoice number for
 * `(tenantId, series, year)` via a single `INSERT ... ON CONFLICT (tenant_id, series, year)
 * DO UPDATE SET last_number = last_number + 1 RETURNING last_number` —
 * race-safe under concurrent issuance requests because the increment
 * happens as one statement evaluated by Postgres itself (not a
 * read-then-write round trip from the application), and
 * `invoice_number_sequences_tenant_year_unique` (drizzle/schema.ts) is
 * exactly the unique constraint `onConflictDoUpdate` needs to target.
 *
 * Must be called with a `db` whose connection already has
 * `app.current_tenant_id` set to `tenantId` (i.e. `req.tenantDb`, inside the
 * request's already-open RLS transaction — see
 * `TenantContextMiddleware`) — `invoice_number_sequences` has `FORCE ROW
 * LEVEL SECURITY` (drizzle/rls-policies.sql), so both the tentative insert
 * row's `tenant_id` and the `WITH CHECK` policy must agree with that
 * setting or the insert is rejected outright.
 *
 * Returns the newly allocated (already-incremented) `lastNumber` — i.e. the
 * sequence number this specific caller now owns.
 */
export async function allocateNextInvoiceSequence(
  db: TenantDb,
  tenantId: string,
  year: number,
  series = "",
): Promise<number> {
  const [row] = await db
    .insert(schema.invoiceNumberSequences)
    .values({ tenantId, series, year, lastNumber: 1 })
    .onConflictDoUpdate({
      target: [
        schema.invoiceNumberSequences.tenantId,
        schema.invoiceNumberSequences.series,
        schema.invoiceNumberSequences.year,
      ],
      set: { lastNumber: sql`${schema.invoiceNumberSequences.lastNumber} + 1` },
    })
    .returning({ lastNumber: schema.invoiceNumberSequences.lastNumber });

  if (!row) {
    // Should be unreachable: `INSERT ... ON CONFLICT DO UPDATE ... RETURNING`
    // always returns exactly one row (either the fresh insert or the
    // updated conflict row) unless the statement itself failed, which would
    // have thrown instead of resolving with an empty array.
    throw new Error(`allocateNextInvoiceSequence: no row returned for tenant ${tenantId}, year ${year}`);
  }

  return row.lastNumber;
}

/**
 * Derives a variable symbol ("variabilní symbol") from an invoice number by
 * stripping all non-digit characters (e.g. `"2026-0001"` -> `"20260001"`).
 * Conventionally equal to the invoice number's digits per Czech invoicing
 * practice, and `variable_symbol` is `varchar(10)` — a `{year}-{4-digit
 * sequence}` invoice number always yields exactly 8 digits, comfortably
 * under that limit.
 */
export function deriveVariableSymbol(invoiceNumber: string): string {
  return invoiceNumber.replace(/\D/g, "").slice(0, 10);
}
