import { ConflictException } from "@nestjs/common";
import {
  DEFAULT_NUMBER_SERIES,
  effectiveNumberPattern,
  MAX_INVOICE_NUMBER_LENGTH,
  NUMBER_DOCUMENT_TYPES,
  numberPeriod,
  renderDocumentNumber,
  validateNumberPattern,
  type NumberFormats,
} from "@faktur/cz-compliance";
import { and, eq, sql } from "drizzle-orm";
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
export const DOCUMENT_SERIES: Record<DocumentType, string> = DEFAULT_NUMBER_SERIES;

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
 * `(tenantId, series, year, month)` (month 0 = the yearly counter) via a
 * single `INSERT ... ON CONFLICT (tenant_id, series, year, month)
 * DO UPDATE SET last_number = last_number + 1 RETURNING last_number` —
 * race-safe under concurrent issuance requests because the increment
 * happens as one statement evaluated by Postgres itself (not a
 * read-then-write round trip from the application), and
 * `invoice_number_sequences_tenant_series_year_month_unique` (drizzle/schema.ts) is
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
  month = 0,
): Promise<number> {
  const [row] = await db
    .insert(schema.invoiceNumberSequences)
    .values({ tenantId, series, year, month, lastNumber: 1 })
    .onConflictDoUpdate({
      target: [
        schema.invoiceNumberSequences.tenantId,
        schema.invoiceNumberSequences.series,
        schema.invoiceNumberSequences.year,
        schema.invoiceNumberSequences.month,
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

/** Stored `tenants.number_formats`, keeping only valid patterns (tolerant of a hand-edited row). */
export function numberFormatsOf(stored: unknown): NumberFormats {
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return {};
  const out: NumberFormats = {};
  for (const type of NUMBER_DOCUMENT_TYPES) {
    const pattern = (stored as Record<string, unknown>)[type];
    if (typeof pattern === "string" && validateNumberPattern(pattern) === null) out[type] = pattern;
  }
  return out;
}

/**
 * How many taken numbers in a row issuance steps over before giving up. A
 * rendered number can already exist when history was imported in the same
 * format, or after the "next number" was set lower.
 */
export const MAX_NUMBER_COLLISION_SKIPS = 1000;

/**
 * Takes sequences from `next` until the rendered number is free. Each
 * skipped sequence stays used, so the counter never hands it out again.
 */
export async function firstFreeNumber(opts: {
  next: () => Promise<number>;
  render: (sequence: number) => string;
  isTaken: (invoiceNumber: string) => Promise<boolean>;
  maxTries?: number;
}): Promise<{ sequence: number; invoiceNumber: string }> {
  const maxTries = opts.maxTries ?? MAX_NUMBER_COLLISION_SKIPS;
  for (let i = 0; i < maxTries; i++) {
    const sequence = await opts.next();
    const invoiceNumber = opts.render(sequence);
    if (invoiceNumber.length > MAX_INVOICE_NUMBER_LENGTH) {
      throw new ConflictException({ error: "invoice_number_too_long", invoiceNumber });
    }
    if (!(await opts.isTaken(invoiceNumber))) return { sequence, invoiceNumber };
  }
  throw new ConflictException({ error: "invoice_number_exhausted" });
}

export async function invoiceNumberTaken(db: TenantDb, tenantId: string, invoiceNumber: string): Promise<boolean> {
  const rows = await db
    .select({ id: schema.invoices.id })
    .from(schema.invoices)
    .where(and(eq(schema.invoices.tenantId, tenantId), eq(schema.invoices.invoiceNumber, invoiceNumber)))
    .limit(1);
  return rows.length > 0;
}

/** The company's number patterns (empty = built-in format for every type). */
export async function loadNumberFormats(db: TenantDb, tenantId: string): Promise<NumberFormats> {
  const [row] = await db
    .select({ numberFormats: schema.tenants.numberFormats })
    .from(schema.tenants)
    .where(eq(schema.tenants.id, tenantId))
    .limit(1);
  return numberFormatsOf(row?.numberFormats);
}

/**
 * Allocates the number for a document issued on `issueDate`: the type's own
 * series (types never share a counter), the period its pattern resets in,
 * and the first sequence whose rendered number is not taken yet.
 */
export async function allocateInvoiceNumber(
  db: TenantDb,
  tenantId: string,
  documentType: DocumentType,
  issueDate: Date,
  formats: NumberFormats,
): Promise<{ sequence: number; invoiceNumber: string }> {
  const pattern = effectiveNumberPattern(formats, documentType);
  const { year, month } = numberPeriod(pattern, issueDate);
  const series = DOCUMENT_SERIES[documentType];
  return firstFreeNumber({
    next: () => allocateNextInvoiceSequence(db, tenantId, year, series, month),
    render: (sequence) => renderDocumentNumber(pattern, { year, month, sequence }),
    isTaken: (n) => invoiceNumberTaken(db, tenantId, n),
  });
}

/** Last number used in one counter (0 when the counter has no row yet). */
export async function lastSequence(db: TenantDb, tenantId: string, series: string, year: number, month: number): Promise<number> {
  const [row] = await db
    .select({ lastNumber: schema.invoiceNumberSequences.lastNumber })
    .from(schema.invoiceNumberSequences)
    .where(
      and(
        eq(schema.invoiceNumberSequences.tenantId, tenantId),
        eq(schema.invoiceNumberSequences.series, series),
        eq(schema.invoiceNumberSequences.year, year),
        eq(schema.invoiceNumberSequences.month, month),
      ),
    )
    .limit(1);
  return row?.lastNumber ?? 0;
}

export interface SequenceBump {
  series: string;
  year: number;
  month: number;
  sequence: number;
}

/** Raises each counter to at least `sequence` (never lowers one). */
export async function bumpInvoiceSequences(db: TenantDb, tenantId: string, bumps: Iterable<SequenceBump>): Promise<void> {
  for (const { series, year, month, sequence } of bumps) {
    await db.execute(sql`
      INSERT INTO invoice_number_sequences (tenant_id, series, year, month, last_number)
      VALUES (${tenantId}, ${series}, ${year}, ${month}, ${sequence})
      ON CONFLICT (tenant_id, series, year, month)
      DO UPDATE SET last_number = GREATEST(invoice_number_sequences.last_number, EXCLUDED.last_number)
    `);
  }
}
