import { BadRequestException, ConflictException } from "@nestjs/common";
import {
  defaultNumberPattern,
  effectiveNumberPattern,
  findNumberPatternClash,
  NUMBER_DOCUMENT_TYPES,
  numberPeriod,
  numberResetPeriod,
  renderDocumentNumber,
  validateNumberPattern,
  type NumberDocumentType,
  type NumberFormats,
} from "@faktur/cz-compliance";
import { and, count, eq, gte, isNotNull, lt, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { z } from "zod";
import * as schema from "../../drizzle/schema";
import { highestImportedSequences } from "../invoices/invoice-import.util";
import {
  bumpInvoiceSequences,
  DOCUMENT_SERIES,
  firstFreeNumber,
  invoiceNumberTaken,
  lastSequence,
  loadNumberFormats,
} from "../invoices/invoice-numbering.util";

type TenantDb = PostgresJsDatabase<typeof schema>;

/**
 * Settings → Číslování dokladů: the company's own number pattern per
 * document type (`tenants.number_formats`), so numbering carries on in the
 * style of the tool they moved from (BitFaktura `1/10/2026`, `FV2026001`…).
 * Only numbers allocated from now on follow it; issued documents keep theirs.
 */

const patternSchema = z
  .string()
  .trim()
  .max(64)
  .nullable()
  .superRefine((v, ctx) => {
    const error = v ? validateNumberPattern(v) : null;
    if (error) ctx.addIssue({ code: z.ZodIssueCode.custom, message: error });
  });

const nextNumberSchema = z.coerce.number().int().min(1).max(999_999).nullable();

const perType = <T extends z.ZodTypeAny>(item: T) =>
  z.object({ invoice: item.optional(), proforma: item.optional(), credit_note: item.optional(), quote: item.optional() });

export const numberFormatsInputSchema = z.object({
  /** null or "" = back to the built-in format; a type left out stays as it is. */
  formats: perType(patternSchema).default({}),
  /** "Next number" for the current month/year of each type's counter. */
  nextNumbers: perType(nextNumberSchema).default({}),
});

export type NumberFormatsInput = z.output<typeof numberFormatsInputSchema>;

export interface NumberFormatView {
  type: NumberDocumentType;
  /** The company's own pattern, null = built-in. */
  pattern: string | null;
  defaultPattern: string;
  reset: "monthly" | "yearly";
  /** Last sequence used this year (yearly counter) and this month (monthly counter). */
  lastYearly: number;
  lastMonthly: number;
  nextSequence: number | null;
  nextNumber: string | null;
}

export interface NumberFormatsView {
  year: number;
  month: number;
  types: NumberFormatView[];
}

/** Merges the input onto what is stored: a pattern equal to the built-in one is stored as "none". */
export function mergeNumberFormats(current: NumberFormats, input: NumberFormatsInput["formats"]): NumberFormats {
  const next: NumberFormats = { ...current };
  for (const type of NUMBER_DOCUMENT_TYPES) {
    const value = input[type];
    if (value === undefined) continue;
    if (!value || value === defaultNumberPattern(type)) delete next[type];
    else next[type] = value;
  }
  return next;
}

/** The next free number in a counter, without using it up (the settings preview). */
async function previewNext(db: TenantDb, tenantId: string, pattern: string, series: string, year: number, month: number, last: number) {
  let counter = last;
  try {
    return await firstFreeNumber({
      next: async () => ++counter,
      render: (sequence) => renderDocumentNumber(pattern, { year, month, sequence }),
      isTaken: (n) => invoiceNumberTaken(db, tenantId, n),
    });
  } catch {
    return null;
  }
}

export async function getNumberFormats(db: TenantDb, tenantId: string, now = new Date()): Promise<NumberFormatsView> {
  const formats = await loadNumberFormats(db, tenantId);
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const types: NumberFormatView[] = [];
  for (const type of NUMBER_DOCUMENT_TYPES) {
    const pattern = effectiveNumberPattern(formats, type);
    const series = DOCUMENT_SERIES[type];
    const lastYearly = await lastSequence(db, tenantId, series, year, 0);
    const lastMonthly = await lastSequence(db, tenantId, series, year, month);
    const reset = numberResetPeriod(pattern);
    const period = numberPeriod(pattern, now);
    const next = await previewNext(db, tenantId, pattern, series, period.year, period.month, reset === "monthly" ? lastMonthly : lastYearly);
    types.push({
      type,
      pattern: formats[type] ?? null,
      defaultPattern: defaultNumberPattern(type),
      reset,
      lastYearly,
      lastMonthly,
      nextSequence: next?.sequence ?? null,
      nextNumber: next?.invoiceNumber ?? null,
    });
  }
  return { year, month, types };
}

/** Start and end of a counter's period, for "are there documents in it yet". */
export function periodRange(year: number, month: number): { from: Date; to: Date } {
  return month === 0
    ? { from: new Date(year, 0, 1), to: new Date(year + 1, 0, 1) }
    : { from: new Date(year, month - 1, 1), to: new Date(year, month, 1) };
}

/**
 * Saves the patterns, then:
 *  - raises each changed type's counters past numbers that already exist in
 *    the new pattern (e.g. history imported before the pattern was set);
 *  - applies "next number": moving a counter up is always fine, moving it
 *    down only while the period has no issued document of that type yet.
 * Runs in the request's transaction, so a refused "next number" saves nothing.
 */
export async function saveNumberFormats(
  db: TenantDb,
  tenantId: string,
  input: NumberFormatsInput,
  now = new Date(),
): Promise<{ before: NumberFormats; after: NumberFormats }> {
  const before = await loadNumberFormats(db, tenantId);
  const after = mergeNumberFormats(before, input.formats);
  const clash = findNumberPatternClash(after);
  if (clash) throw new BadRequestException({ error: "pattern_clash", type: clash });

  await db
    .update(schema.tenants)
    .set({ numberFormats: Object.keys(after).length > 0 ? after : null, updatedAt: now })
    .where(eq(schema.tenants.id, tenantId));

  const changed = NUMBER_DOCUMENT_TYPES.filter((t) => effectiveNumberPattern(before, t) !== effectiveNumberPattern(after, t));
  for (const type of changed) {
    const existing = await db
      .select({ invoiceNumber: schema.invoices.invoiceNumber })
      .from(schema.invoices)
      .where(and(eq(schema.invoices.tenantId, tenantId), eq(schema.invoices.documentType, type), isNotNull(schema.invoices.invoiceNumber)));
    const numbers = existing.flatMap((r) => (r.invoiceNumber ? [{ invoiceNumber: r.invoiceNumber, documentType: type }] : []));
    await bumpInvoiceSequences(db, tenantId, highestImportedSequences(numbers, after));
  }

  for (const type of NUMBER_DOCUMENT_TYPES) {
    const next = input.nextNumbers[type];
    if (next == null) continue;
    await setNextNumber(db, tenantId, type, effectiveNumberPattern(after, type), next, now);
  }
  return { before, after };
}

export async function setNextNumber(db: TenantDb, tenantId: string, type: NumberDocumentType, pattern: string, next: number, now: Date) {
  const { year, month } = numberPeriod(pattern, now);
  const series = DOCUMENT_SERIES[type];
  const last = await lastSequence(db, tenantId, series, year, month);
  const target = next - 1;
  if (target === last) return;
  if (target > last) {
    await bumpInvoiceSequences(db, tenantId, [{ series, year, month, sequence: target }]);
    return;
  }
  const { from, to } = periodRange(year, month);
  const [row] = await db
    .select({ n: count() })
    .from(schema.invoices)
    .where(
      and(
        eq(schema.invoices.tenantId, tenantId),
        eq(schema.invoices.documentType, type),
        isNotNull(schema.invoices.invoiceNumber),
        gte(schema.invoices.issueDate, from),
        lt(schema.invoices.issueDate, to),
      ),
    );
  if (Number(row?.n ?? 0) > 0) {
    throw new ConflictException({ error: "next_number_too_low", type, minimum: last + 1 });
  }
  await db.execute(sql`
    UPDATE invoice_number_sequences SET last_number = ${target}
    WHERE tenant_id = ${tenantId} AND series = ${series} AND year = ${year} AND month = ${month}
  `);
}
