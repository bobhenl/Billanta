import { randomUUID } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Injectable } from "@nestjs/common";
import Database from "better-sqlite3";
import type { ExportBundle } from "./export.service";

/**
 * Builds the actual downloadable SQLite database file for a `type: "local"`
 * backup destination — the founder's specific ask was a real "local db"
 * option, not just another JSON dump: a tenant should be able to open the
 * downloaded `.db` file with any ordinary SQLite browser/tool and run real
 * SQL against it. This class NEVER touches Postgres itself — it only
 * consumes the `ExportBundle` already produced by `ExportService
 * .buildExportBundle` (the same RLS-scoped, tenant-isolated query logic the
 * `webhook`/`google_drive` paths use), so there is exactly one place in this
 * codebase that knows how to query a tenant's own data for export.
 *
 * ============================================================================
 * WHY A TEMP FILE, NOT AN IN-MEMORY DATABASE
 * ============================================================================
 * `better-sqlite3` supports an in-memory database (`new Database(":memory:")`
 * or `new Database()`), which would avoid touching disk at all. This
 * deliberately uses a real temp file instead, because `Database.serialize()`
 * (the API that would otherwise turn an in-memory DB into a `Buffer`)
 * round-trips through disk internally in some `better-sqlite3` versions
 * anyway, AND because writing directly to a file is the simplest way to
 * guarantee the WAL/rollback-journal machinery flushes everything durably
 * before this reads the file back with `fs.readFile` — deliberately not
 * "as fast/clever as possible", just the most obviously-correct way to end
 * up with the exact bytes SQLite itself considers a valid, complete
 * database file. The temp file lives only for the duration of this one call:
 * `os.tmpdir()` + a `crypto.randomUUID()` filename (never a predictable
 * name, never reused across calls), deleted in a `finally` so it is removed
 * whether generation succeeded or threw — this server must never accumulate
 * tenant export files on disk, not even transiently across requests.
 */
@Injectable()
export class SqliteExportService {
  /**
   * Builds a real SQLite database from `bundle` — `invoices` (with a
   * separate `invoice_line_items` table, foreign-keyed back to `invoices`,
   * exactly like the Postgres schema this mirrors), `contacts`, `expenses`,
   * plus a single-row `export_metadata` table carrying the tenant header
   * info (`bundle.tenant`, `bundle.exportedAt`) so the file is
   * self-describing when opened cold in an unrelated SQLite tool. Returns
   * the file's bytes as a `Buffer` — the temp file itself is always deleted
   * before this returns (or throws), see this class's doc comment.
   */
  async buildSqliteFile(bundle: ExportBundle): Promise<Buffer> {
    const filePath = join(tmpdir(), `faktur-sqlite-export-${randomUUID()}.db`);

    try {
      const db = new Database(filePath);
      try {
        this.createSchema(db);
        this.insertData(db, bundle);
      } finally {
        // Closing before reading matters: SQLite may still be holding
        // pending WAL/journal data that hasn't been merged into the main
        // file until the connection is closed cleanly.
        db.close();
      }

      return await readFile(filePath);
    } finally {
      // `force: true` so a failure before the file was ever created (e.g.
      // `new Database(filePath)` itself throwing) doesn't throw a second,
      // more confusing error on cleanup.
      await rm(filePath, { force: true });
    }
  }

  /**
   * Real `CREATE TABLE` statements mirroring the exact columns
   * `ExportService.buildExportBundle` selects from `invoices`/
   * `invoice_line_items`/`contacts`/`expenses` (`drizzle/schema.ts`) — not a
   * single JSON-blob column. Column types are intentionally simple (`TEXT`/
   * `INTEGER`/`REAL`) rather than trying to replicate Postgres's `numeric`/
   * `jsonb`/`uuid` types exactly: SQLite itself only has five storage
   * classes and no server-side type enforcement, so this picks whichever
   * SQLite affinity keeps the value queryable/sortable/exact for that
   * column (`TEXT` for money/quantity fields — see `toSqliteValue` below for
   * why — rather than `REAL`, which would reintroduce float rounding error
   * into monetary amounts).
   */
  private createSchema(db: InstanceType<typeof Database>): void {
    db.exec(`
      CREATE TABLE export_metadata (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        exported_at TEXT NOT NULL,
        tenant_id TEXT,
        tenant_company_name TEXT,
        tenant_legal_name TEXT,
        tenant_ico TEXT,
        tenant_dic TEXT
      );

      CREATE TABLE contacts (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        ico TEXT,
        dic TEXT,
        legal_name TEXT NOT NULL,
        email TEXT,
        address_street TEXT,
        address_city TEXT,
        address_postal_code TEXT,
        address_country TEXT,
        ares_verified_at TEXT,
        is_vat_payer INTEGER,
        created_at TEXT,
        updated_at TEXT
      );

      CREATE TABLE invoices (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        contact_id TEXT,
        invoice_number TEXT,
        variable_symbol TEXT,
        issue_date TEXT,
        due_date TEXT,
        currency TEXT,
        status TEXT,
        source TEXT,
        ai_confidence_score TEXT,
        issued_by_user_id TEXT,
        issued_at TEXT,
        ai_draft_reviewed_at TEXT,
        needs_attention INTEGER,
        raw_ai_payload TEXT,
        public_token TEXT,
        sent_at TEXT,
        last_reminder_sent_at TEXT,
        reminder_count INTEGER,
        created_at TEXT,
        updated_at TEXT
      );

      CREATE TABLE invoice_line_items (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        invoice_id TEXT NOT NULL REFERENCES invoices(id),
        description TEXT NOT NULL,
        quantity TEXT,
        unit_price TEXT,
        vat_rate TEXT,
        sort_order INTEGER,
        created_at TEXT
      );

      CREATE TABLE expenses (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        supplier_contact_id TEXT,
        supplier_name_raw TEXT,
        description TEXT NOT NULL,
        amount TEXT,
        vat_rate TEXT,
        currency TEXT,
        expense_date TEXT,
        category TEXT,
        receipt_file_url TEXT,
        created_at TEXT
      );

      CREATE INDEX invoice_line_items_invoice_id_idx ON invoice_line_items(invoice_id);
    `);
  }

  private insertData(db: InstanceType<typeof Database>, bundle: ExportBundle): void {
    db.prepare(
      `INSERT INTO export_metadata
        (id, exported_at, tenant_id, tenant_company_name, tenant_legal_name, tenant_ico, tenant_dic)
       VALUES (1, ?, ?, ?, ?, ?, ?)`,
    ).run(
      bundle.exportedAt,
      bundle.tenant.id,
      bundle.tenant.companyName,
      bundle.tenant.legalName,
      bundle.tenant.ico,
      bundle.tenant.dic,
    );

    const insertContact = db.prepare(
      `INSERT INTO contacts
        (id, tenant_id, ico, dic, legal_name, email, address_street, address_city,
         address_postal_code, address_country, ares_verified_at, is_vat_payer, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const contact of bundle.contacts) {
      insertContact.run(
        contact.id,
        contact.tenantId,
        contact.ico,
        contact.dic,
        contact.legalName,
        contact.email,
        contact.addressStreet,
        contact.addressCity,
        contact.addressPostalCode,
        contact.addressCountry,
        toSqliteValue(contact.aresVerifiedAt),
        toSqliteValue(contact.isVatPayer),
        toSqliteValue(contact.createdAt),
        toSqliteValue(contact.updatedAt),
      );
    }

    const insertInvoice = db.prepare(
      `INSERT INTO invoices
        (id, tenant_id, contact_id, invoice_number, variable_symbol, issue_date, due_date,
         currency, status, source, ai_confidence_score, issued_by_user_id, issued_at,
         ai_draft_reviewed_at, needs_attention, raw_ai_payload, public_token, sent_at,
         last_reminder_sent_at, reminder_count, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const insertLineItem = db.prepare(
      `INSERT INTO invoice_line_items
        (id, tenant_id, invoice_id, description, quantity, unit_price, vat_rate, sort_order, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const invoice of bundle.invoices) {
      insertInvoice.run(
        invoice.id,
        invoice.tenantId,
        invoice.contactId,
        invoice.invoiceNumber,
        invoice.variableSymbol,
        toSqliteValue(invoice.issueDate),
        toSqliteValue(invoice.dueDate),
        invoice.currency,
        invoice.status,
        invoice.source,
        invoice.aiConfidenceScore,
        invoice.issuedByUserId,
        toSqliteValue(invoice.issuedAt),
        toSqliteValue(invoice.aiDraftReviewedAt),
        toSqliteValue(invoice.needsAttention),
        toSqliteValue(invoice.rawAiPayload),
        invoice.publicToken,
        toSqliteValue(invoice.sentAt),
        toSqliteValue(invoice.lastReminderSentAt),
        invoice.reminderCount,
        toSqliteValue(invoice.createdAt),
        toSqliteValue(invoice.updatedAt),
      );

      for (const lineItem of invoice.lineItems) {
        insertLineItem.run(
          lineItem.id,
          lineItem.tenantId,
          lineItem.invoiceId,
          lineItem.description,
          lineItem.quantity,
          lineItem.unitPrice,
          lineItem.vatRate,
          lineItem.sortOrder,
          toSqliteValue(lineItem.createdAt),
        );
      }
    }

    const insertExpense = db.prepare(
      `INSERT INTO expenses
        (id, tenant_id, supplier_contact_id, supplier_name_raw, description, amount, vat_rate,
         currency, expense_date, category, receipt_file_url, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const expense of bundle.expenses) {
      insertExpense.run(
        expense.id,
        expense.tenantId,
        expense.supplierContactId,
        expense.supplierNameRaw,
        expense.description,
        expense.amount,
        expense.vatRate,
        expense.currency,
        toSqliteValue(expense.expenseDate),
        expense.category,
        expense.receiptFileUrl,
        toSqliteValue(expense.createdAt),
      );
    }
  }
}

/**
 * `better-sqlite3` bind parameters must be one of `number | bigint | string
 * | Buffer | null` — none of `Date`, `boolean`, or a plain object (`jsonb`
 * columns) qualify, so every value coming out of a Drizzle row needs this
 * narrow conversion before it can be bound:
 *   - `Date` -> its ISO-8601 string (`toISOString()`), so date/time columns
 *     stay directly comparable/sortable as `TEXT` in SQLite the same way
 *     they would as `TIMESTAMPTZ` text output in Postgres.
 *   - `boolean` -> `1`/`0`, SQLite's own convention (it has no native
 *     boolean type).
 *   - a plain object/array (`jsonb` columns, e.g. `rawAiPayload`) ->
 *     `JSON.stringify(...)`, kept queryable via SQLite's own `json_extract`
 *     if a tenant wants that, rather than losing the structure entirely.
 *   - `null`/`undefined` -> `null`.
 *   - anything else (string, number, and the `numeric`-column strings
 *     Drizzle already returns as plain strings) passes through unchanged —
 *     see `createSchema`'s doc comment for why money/quantity columns are
 *     `TEXT`, not `REAL`.
 */
function toSqliteValue(value: unknown): string | number | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "object") return JSON.stringify(value);
  return value as string | number;
}
