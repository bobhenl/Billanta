import { Injectable, Logger } from "@nestjs/common";
import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "../../drizzle/schema";
import { csvCell } from "../exports/csv-cell";
import { InvoicesService } from "../invoices/invoices.service";
import {
  ARCHIVE_ROOT,
  archiveDay,
  archiveYear,
  expenseEInvoiceFile,
  expenseSummaryFile,
  fingerprintOf,
  invoiceAttachmentFiles,
  invoiceFiles,
  invoiceFingerprint,
} from "./archive-layout";
import { syncArchive, type ArchiveEntry, type ArchiveSyncResult, type ArchiveTransform, type ArchiveUploader, type TrackedFile } from "./archive-sync";
import { ZipWriter, type ZipSink } from "./zip-writer";

type TenantDb = PostgresJsDatabase<typeof schema>;
type ExpenseRow = typeof schema.expenses.$inferSelect;

/** Issued documents: numbered, out of the draft stage. Cancelled ones stay, the law keeps them too. */
const ARCHIVED_STATUSES = ["issued", "paid", "cancelled"] as const;

/**
 * The documents themselves, as files a person can open without Billanta
 * (`archive-layout.ts` has the folder layout). Used two ways:
 *   - `syncToDestination`: after the data export of an SFTP / Google Drive
 *     destination, uploads new and changed documents (`archive-sync.ts`);
 *   - `writeZip`: the "Stáhnout archiv" download, one year or everything.
 *
 * Every query goes through the caller's RLS-scoped `db`, like
 * `ExportService`. PDFs and ISDOC are rendered by `InvoicesService`, the same
 * code as the invoice detail's download buttons.
 */
@Injectable()
export class DocumentArchiveService {
  private readonly logger = new Logger(DocumentArchiveService.name);

  constructor(private readonly invoicesService: InvoicesService) {}

  /** Every archived file of the company (or of one year), content loaded on demand. */
  async planEntries(db: TenantDb, tenantId: string, year?: number): Promise<ArchiveEntry[]> {
    const entries: ArchiveEntry[] = [];
    const inYear = (y: number) => year === undefined || y === year;

    const invoices = (
      await db
        .select()
        .from(schema.invoices)
        .where(and(isNotNull(schema.invoices.invoiceNumber), inArray(schema.invoices.status, [...ARCHIVED_STATUSES])))
    ).filter((inv) => inv.issueDate && inv.documentType !== "quote" && inYear(archiveYear(inv.issueDate)));

    const ids = invoices.map((i) => i.id);
    const lineItems = ids.length
      ? await db.select().from(schema.invoiceLineItems).where(inArray(schema.invoiceLineItems.invoiceId, ids))
      : [];
    const attachments = ids.length
      ? await db
          .select({
            id: schema.invoiceAttachments.id,
            invoiceId: schema.invoiceAttachments.invoiceId,
            filename: schema.invoiceAttachments.filename,
            sizeBytes: schema.invoiceAttachments.sizeBytes,
          })
          .from(schema.invoiceAttachments)
          .where(inArray(schema.invoiceAttachments.invoiceId, ids))
      : [];
    const itemsBy = groupBy(lineItems, (l) => l.invoiceId);
    const attachmentsBy = groupBy(attachments, (a) => a.invoiceId);

    for (const inv of invoices) {
      const ref = { id: inv.id, invoiceNumber: inv.invoiceNumber!, documentType: inv.documentType, issueDate: inv.issueDate! };
      const fingerprint = invoiceFingerprint(inv, itemsBy.get(inv.id) ?? []);
      for (const file of invoiceFiles(ref)) {
        entries.push({
          ...file,
          fingerprint: fingerprintOf(file.kind, fingerprint),
          load:
            file.kind === "pdf"
              ? () => this.invoicesService.generateInvoicePdf(db, tenantId, inv.id)
              : async () => Buffer.from(await this.invoicesService.generateInvoiceIsdoc(db, tenantId, inv.id), "utf8"),
        });
      }
      const own = (attachmentsBy.get(inv.id) ?? []).sort((a, b) => a.id.localeCompare(b.id));
      invoiceAttachmentFiles(ref, own.map((a) => a.filename)).forEach((file, i) => {
        const a = own[i];
        entries.push({ ...file, fingerprint: fingerprintOf("attachment", a.id, a.sizeBytes), load: () => this.attachmentData(db, a.id) });
      });
    }

    const expenses = (await db.select().from(schema.expenses)).filter((e) => inYear(archiveYear(e.expenseDate)));
    const contactNames = await this.contactNames(db, expenses);
    const supplierOf = (e: ExpenseRow) => e.supplierNameRaw ?? (e.supplierContactId ? contactNames.get(e.supplierContactId) : null) ?? null;

    for (const [y, rows] of groupBy(expenses, (e) => archiveYear(e.expenseDate))) {
      const csv = expensesCsv(rows, supplierOf);
      entries.push({ ...expenseSummaryFile(y), fingerprint: fingerprintOf("expenses-csv", csv), load: async () => csv });
    }

    const byExpense = new Map(expenses.map((e) => [e.id, e]));
    if (byExpense.size) {
      const einvoices = await db
        .select({ id: schema.incomingEInvoices.id, expenseId: schema.incomingEInvoices.expenseId, sha: schema.incomingEInvoices.xmlSha256 })
        .from(schema.incomingEInvoices)
        .where(isNotNull(schema.incomingEInvoices.expenseId));
      for (const ei of einvoices) {
        const e = ei.expenseId ? byExpense.get(ei.expenseId) : undefined;
        if (!e) continue;
        const file = expenseEInvoiceFile({ id: e.id, expenseDate: e.expenseDate, supplierName: supplierOf(e), documentNumber: e.documentNumber });
        entries.push({ ...file, fingerprint: fingerprintOf("einvoice", ei.id, ei.sha), load: () => this.einvoiceXml(db, ei.id) });
      }
    }

    // Two expenses with the same date, supplier and number would share a name.
    return uniqueByPath(entries);
  }

  /** Years with at least one archived document, newest first (the download picker). */
  async years(db: TenantDb): Promise<number[]> {
    const rows = await db.execute<{ y: number }>(sql`
      SELECT DISTINCT extract(year FROM issue_date AT TIME ZONE 'Europe/Prague')::int AS y FROM invoices
        WHERE invoice_number IS NOT NULL AND issue_date IS NOT NULL AND document_type <> 'quote'
          AND status IN ('issued', 'paid', 'cancelled')
      UNION
      SELECT DISTINCT extract(year FROM expense_date AT TIME ZONE 'Europe/Prague')::int FROM expenses
      ORDER BY 1 DESC`);
    return rows.map((r) => Number(r.y));
  }

  /**
   * Uploads new and changed documents to one destination and records them in
   * `document_archive_files`. `uploader` is the open SFTP / Drive session.
   */
  async syncToDestination(
    db: TenantDb,
    tenantId: string,
    destinationId: string,
    uploader: ArchiveUploader,
    transform?: ArchiveTransform,
  ): Promise<ArchiveSyncResult> {
    const entries = await this.planEntries(db, tenantId);
    const rows = await db
      .select({ path: schema.documentArchiveFiles.path, fingerprint: schema.documentArchiveFiles.fingerprint, remoteId: schema.documentArchiveFiles.remoteId })
      .from(schema.documentArchiveFiles)
      .where(eq(schema.documentArchiveFiles.destinationId, destinationId));
    const tracked = new Map<string, TrackedFile>(rows.map((r) => [r.path, { fingerprint: r.fingerprint, remoteId: r.remoteId }]));

    const result = await syncArchive({
      entries,
      tracked,
      uploader,
      transform,
      tracker: {
        record: async (path, fingerprint, remoteId, sizeBytes) => {
          const set = { fingerprint, remoteId, sizeBytes, uploadedAt: new Date() };
          await db
            .insert(schema.documentArchiveFiles)
            .values({ tenantId, destinationId, path, ...set })
            .onConflictDoUpdate({ target: [schema.documentArchiveFiles.destinationId, schema.documentArchiveFiles.path], set });
        },
      },
    });
    for (const f of result.failed) this.logger.warn(`archive: ${f.path} skipped for tenant ${tenantId}: ${f.error}`);
    return result;
  }

  /**
   * The ZIP download. Entries are written one by one into `sink` (the HTTP
   * response); a document that cannot be generated is listed in
   * `Billanta/CHYBY.txt` instead of breaking the download half-way.
   */
  async writeZip(db: TenantDb, tenantId: string, year: number | undefined, sink: ZipSink): Promise<{ files: number; failed: number }> {
    const entries = (await this.planEntries(db, tenantId, year)).sort((a, b) => a.path.localeCompare(b.path));
    const zip = new ZipWriter(sink);
    const failed: string[] = [];
    for (const entry of entries) {
      let data: Buffer;
      try {
        data = await entry.load();
      } catch (err) {
        failed.push(`${entry.path}: ${(err as Error).message}`);
        continue;
      }
      await zip.add(entry.path, data);
    }
    if (failed.length) {
      await zip.add(`${ARCHIVE_ROOT}/CHYBY.txt`, Buffer.from(`Tyto doklady se nepodařilo vytvořit:\r\n${failed.join("\r\n")}\r\n`, "utf8"));
    }
    await zip.finish();
    return { files: zip.count, failed: failed.length };
  }

  private async attachmentData(db: TenantDb, id: string): Promise<Buffer> {
    const [row] = await db
      .select({ data: schema.invoiceAttachments.data })
      .from(schema.invoiceAttachments)
      .where(eq(schema.invoiceAttachments.id, id))
      .limit(1);
    if (!row) throw new Error("attachment not found");
    return Buffer.from(row.data, "base64");
  }

  private async einvoiceXml(db: TenantDb, id: string): Promise<Buffer> {
    const [row] = await db
      .select({ xml: schema.incomingEInvoices.xml })
      .from(schema.incomingEInvoices)
      .where(eq(schema.incomingEInvoices.id, id))
      .limit(1);
    if (!row) throw new Error("e-invoice not found");
    return Buffer.from(row.xml, "utf8");
  }

  private async contactNames(db: TenantDb, expenses: ExpenseRow[]): Promise<Map<string, string>> {
    const ids = [...new Set(expenses.map((e) => e.supplierContactId).filter((id): id is string => Boolean(id)))];
    if (!ids.length) return new Map();
    const rows = await db
      .select({ id: schema.contacts.id, name: schema.contacts.legalName })
      .from(schema.contacts)
      .where(inArray(schema.contacts.id, ids));
    return new Map(rows.map((r) => [r.id, r.name]));
  }
}

function groupBy<T, K>(rows: T[], key: (row: T) => K): Map<K, T[]> {
  const out = new Map<K, T[]>();
  for (const row of rows) {
    const k = key(row);
    const bucket = out.get(k);
    if (bucket) bucket.push(row);
    else out.set(k, [row]);
  }
  return out;
}

/** Keeps the first entry per path (case-insensitive, for Windows and Drive). */
export function uniqueByPath(entries: ArchiveEntry[]): ArchiveEntry[] {
  const seen = new Set<string>();
  return entries.filter((e) => {
    const k = e.path.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

const EXPENSE_HEADER = [
  "Datum",
  "Dodavatel",
  "IČO",
  "DIČ",
  "Číslo dokladu",
  "Variabilní symbol",
  "Popis",
  "Kategorie",
  "Částka",
  "Sazba DPH %",
  "Měna",
  "Přenesená daňová povinnost",
  "Splatnost",
  "Zaplaceno",
  "Odkaz na doklad",
  "Poznámka",
];

/** The year's expenses as a semicolon CSV for Czech Excel (BOM, decimal comma). */
export function expensesCsv(rows: ExpenseRow[], supplierOf: (e: ExpenseRow) => string | null): Buffer {
  const sorted = [...rows].sort((a, b) => a.expenseDate.getTime() - b.expenseDate.getTime() || a.id.localeCompare(b.id));
  const lines = [EXPENSE_HEADER.join(";")];
  for (const e of sorted) {
    lines.push(
      [
        archiveDay(e.expenseDate),
        supplierOf(e),
        e.supplierIco,
        e.supplierDic,
        e.documentNumber,
        e.variableSymbol,
        e.description,
        e.category,
        Number(e.amount),
        Number(e.vatRate),
        e.currency,
        e.reverseCharge ? "ano" : "ne",
        e.dueDate ? archiveDay(e.dueDate) : null,
        e.paidAt ? archiveDay(e.paidAt) : null,
        e.receiptFileUrl,
        e.note,
      ]
        .map(csvCell)
        .join(";"),
    );
  }
  return Buffer.from(`﻿${lines.join("\r\n")}\r\n`, "utf8");
}
