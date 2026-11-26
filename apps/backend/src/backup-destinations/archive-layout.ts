import { createHash } from "node:crypto";

/**
 * Where each document goes in the archive on the company's own storage and in
 * the ZIP download. A person browsing the folder should find a document
 * without Billanta:
 *
 *   Billanta/2026/vydane/2026-0001.pdf          issued invoices and credit notes
 *   Billanta/2026/vydane/2026-0001.isdoc        ISDOC of a tax invoice
 *   Billanta/2026/vydane/prilohy/2026-0001/…    files attached to the invoice
 *   Billanta/2026/zalohove/ZF-2026-01.pdf       proforma invoices
 *   Billanta/2026/naklady/naklady-2026.csv      the year's expenses as a table
 *   Billanta/2026/naklady/2026-03-02_Alza_123.xml  a received e-invoice
 *
 * Quotes are not accounting documents and stay out. The year is the issue
 * (expense) date in Prague time.
 */
export const ARCHIVE_ROOT = "Billanta";

export type ArchiveDocumentType = "invoice" | "proforma" | "credit_note" | "quote";

/** Folder per document type; null = not archived. */
export function invoiceFolder(documentType: ArchiveDocumentType): string | null {
  if (documentType === "invoice" || documentType === "credit_note") return "vydane";
  if (documentType === "proforma") return "zalohove";
  return null;
}

const PRAGUE_YEAR = new Intl.DateTimeFormat("en", { timeZone: "Europe/Prague", year: "numeric" });
const PRAGUE_DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Prague", year: "numeric", month: "2-digit", day: "2-digit" });

export function archiveYear(date: Date): number {
  return Number(PRAGUE_YEAR.format(date));
}

/** YYYY-MM-DD in Prague time. */
export function archiveDay(date: Date): string {
  return PRAGUE_DAY.format(date);
}

/**
 * One path segment that is safe on Windows, macOS, Linux, SFTP and Drive:
 * no slashes or reserved characters, no control characters, no leading dots
 * (hidden files, `..`), at most `max` characters. Diacritics stay, they are
 * fine everywhere and a Czech supplier name should read as such.
 */
export function safeSegment(value: string, max = 80): string {
  const cleaned = value
    .normalize("NFC")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[.\s-]+/, "")
    .replace(/[.\s]+$/, "")
    .slice(0, max)
    .trim();
  return cleaned || "bez-nazvu";
}

export interface ArchiveInvoiceRef {
  id: string;
  invoiceNumber: string;
  documentType: ArchiveDocumentType;
  issueDate: Date;
}

export interface PlannedFile {
  /** Path relative to the destination root, segments joined with `/`. */
  path: string;
  year: number;
  mime: string;
}

const join = (...segments: (string | number)[]) => segments.join("/");

/** PDF (+ ISDOC for a tax invoice) of one issued document; empty for quotes. */
export function invoiceFiles(inv: ArchiveInvoiceRef): (PlannedFile & { kind: "pdf" | "isdoc" })[] {
  const folder = invoiceFolder(inv.documentType);
  if (!folder) return [];
  const year = archiveYear(inv.issueDate);
  const name = safeSegment(inv.invoiceNumber);
  const files: (PlannedFile & { kind: "pdf" | "isdoc" })[] = [
    { kind: "pdf", path: join(ARCHIVE_ROOT, year, folder, `${name}.pdf`), year, mime: "application/pdf" },
  ];
  // The ISDOC generator writes DocumentType 1 (invoice) only.
  if (inv.documentType === "invoice") {
    files.push({ kind: "isdoc", path: join(ARCHIVE_ROOT, year, folder, `${name}.isdoc`), year, mime: "application/xml" });
  }
  return files;
}

/** Attachments of one invoice, with repeated file names numbered. */
export function invoiceAttachmentFiles(inv: ArchiveInvoiceRef, filenames: string[]): PlannedFile[] {
  const folder = invoiceFolder(inv.documentType);
  if (!folder) return [];
  const year = archiveYear(inv.issueDate);
  const dir = join(ARCHIVE_ROOT, year, folder, "prilohy", safeSegment(inv.invoiceNumber));
  return dedupeNames(filenames.map((f) => safeSegment(f, 120))).map((name) => ({
    path: join(dir, name),
    year,
    mime: "application/octet-stream",
  }));
}

export function expenseSummaryFile(year: number): PlannedFile {
  return { path: join(ARCHIVE_ROOT, year, "naklady", `naklady-${year}.csv`), year, mime: "text/csv" };
}

export interface ArchiveExpenseRef {
  id: string;
  expenseDate: Date;
  supplierName: string | null;
  documentNumber: string | null;
}

/** File name stem for an expense's own documents: date, supplier, their number. */
export function expenseStem(e: ArchiveExpenseRef): string {
  const parts = [archiveDay(e.expenseDate), safeSegment(e.supplierName ?? "dodavatel", 40)];
  parts.push(e.documentNumber ? safeSegment(e.documentNumber, 40) : e.id.slice(0, 8));
  return parts.join("_");
}

/** The received e-invoice (UBL XML) behind an expense. */
export function expenseEInvoiceFile(e: ArchiveExpenseRef): PlannedFile {
  const year = archiveYear(e.expenseDate);
  return { path: join(ARCHIVE_ROOT, year, "naklady", `${expenseStem(e)}.xml`), year, mime: "application/xml" };
}

/** `a.pdf, a.pdf, a.pdf` -> `a.pdf, a (2).pdf, a (3).pdf`. */
export function dedupeNames(names: string[]): string[] {
  const seen = new Set<string>();
  return names.map((name) => {
    if (!seen.has(name.toLowerCase())) {
      seen.add(name.toLowerCase());
      return name;
    }
    const dot = name.lastIndexOf(".");
    const [stem, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ""];
    for (let n = 2; ; n++) {
      const candidate = `${stem} (${n})${ext}`;
      if (!seen.has(candidate.toLowerCase())) {
        seen.add(candidate.toLowerCase());
        return candidate;
      }
    }
  });
}

/** Stable JSON: object keys sorted, dates as ISO strings. */
function canonical(value: unknown): string {
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

export function fingerprintOf(...parts: unknown[]): string {
  return createHash("sha256").update(canonical(parts)).digest("hex");
}

/**
 * Invoice columns that never reach the PDF or ISDOC: link analytics,
 * reminder counters, the buyer-details flow, internal notes. A change in them
 * must not re-upload the document.
 */
const INVOICE_VOLATILE_COLUMNS = new Set([
  "updatedAt",
  "sentAt",
  "lastReminderSentAt",
  "reminderCount",
  "publicViewCount",
  "publicFirstViewedAt",
  "publicLastViewedAt",
  "publicToken",
  "publicKey",
  "publicSlug",
  "internalNote",
  "rawAiPayload",
  "aiConfidenceScore",
  "needsAttention",
  "clientResponse",
  "clientRespondedAt",
  "clientResponseName",
  "clientResponseNote",
  "buyerDetailsToken",
  "buyerDetailsRequestedAt",
  "buyerDetailsRequestedBy",
  "buyerDetailsEmail",
  "buyerDetailsAutoIssue",
  "buyerDetailsSubmittedAt",
  "buyerDetailsOutcome",
  "buyerDetailsRequired",
]);

/** What the rendered documents of an invoice depend on. */
export function invoiceFingerprint(invoice: Record<string, unknown>, lineItems: Record<string, unknown>[]): string {
  const relevant = Object.fromEntries(Object.entries(invoice).filter(([k]) => !INVOICE_VOLATILE_COLUMNS.has(k)));
  const items = [...lineItems].sort((a, b) => Number(a.sortOrder ?? 0) - Number(b.sortOrder ?? 0) || String(a.id).localeCompare(String(b.id)));
  return fingerprintOf("invoice:v1", relevant, items);
}
