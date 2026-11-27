import { getTableConfig, type PgColumn, type PgTable } from "drizzle-orm/pg-core";
import * as schema from "../../drizzle/schema";
import type { ExportBundle } from "./export.service";

/*
 * The tables of the SQLite backup, derived from `drizzle/schema.ts` instead
 * of a hand-written column list. A hand list silently fell behind every
 * migration: Confidential mode keeps the real amounts only in `enc_amounts`
 * envelopes (the plain columns hold quantity 1, price 0), so a backup
 * without that column restores as a document worth 0 with nothing to open.
 * Every column the bundle carries now lands in the file.
 *
 * Pure: no native binding, so the layout is testable where better-sqlite3
 * does not build.
 */

export type SqliteValue = string | number | null;

export interface SqliteTable {
  name: string;
  ddl: string;
  columns: string[];
  rows: SqliteValue[][];
}

/**
 * `TEXT` for money and quantities (no float rounding), `INTEGER` for integer
 * and boolean columns, `REAL` for the few float columns, `TEXT` for dates
 * (ISO 8601) and JSON.
 */
function sqliteType(column: PgColumn): "TEXT" | "INTEGER" | "REAL" {
  if (column.dataType === "boolean") return "INTEGER";
  if (column.dataType === "number") return /Integer|Serial|SmallInt/i.test(column.columnType) ? "INTEGER" : "REAL";
  return "TEXT";
}

export function toSqliteValue(value: unknown): SqliteValue {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "object") return JSON.stringify(value);
  return value as string | number;
}

function tableOf(
  table: PgTable,
  rows: Record<string, unknown>[],
  options: { primaryKey?: string; references?: Record<string, string> } = {},
): SqliteTable {
  const config = getTableConfig(table);
  // JS property name → SQL column, in schema order.
  const entries = Object.entries(table as unknown as Record<string, unknown>)
    .filter((e): e is [string, PgColumn] => config.columns.includes(e[1] as PgColumn));
  const defs = entries.map(([, c]) => {
    const parts = [`"${c.name}"`, sqliteType(c)];
    if (c.name === (options.primaryKey ?? "id")) parts.push("PRIMARY KEY");
    const ref = options.references?.[c.name];
    if (ref) parts.push(`REFERENCES ${ref}`);
    return parts.join(" ");
  });
  return {
    name: config.name,
    ddl: `CREATE TABLE "${config.name}" (\n  ${defs.join(",\n  ")}\n)`,
    columns: entries.map(([, c]) => c.name),
    rows: rows.map((row) => entries.map(([key]) => toSqliteValue(row[key]))),
  };
}

export function sqliteLayout(bundle: ExportBundle): SqliteTable[] {
  const metadata: SqliteTable = {
    name: "export_metadata",
    ddl: `CREATE TABLE export_metadata (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  exported_at TEXT NOT NULL,
  tenant_id TEXT,
  tenant_company_name TEXT,
  tenant_legal_name TEXT,
  tenant_ico TEXT,
  tenant_dic TEXT
)`,
    columns: ["id", "exported_at", "tenant_id", "tenant_company_name", "tenant_legal_name", "tenant_ico", "tenant_dic"],
    rows: [[1, bundle.exportedAt, bundle.tenant.id, bundle.tenant.companyName, bundle.tenant.legalName, bundle.tenant.ico, bundle.tenant.dic]],
  };
  const tables = [
    metadata,
    tableOf(schema.contacts, bundle.contacts),
    tableOf(
      schema.invoices,
      bundle.invoices.map(({ lineItems: _items, ...invoice }) => invoice),
    ),
    tableOf(
      schema.invoiceLineItems,
      bundle.invoices.flatMap((i) => i.lineItems),
      { references: { invoice_id: "invoices(id)" } },
    ),
    tableOf(schema.expenses, bundle.expenses),
    tableOf(schema.recurringInvoiceTemplates, bundle.recurringTemplates ?? []),
  ];
  if (bundle.attachments) {
    // As stored: an encrypted file stays ciphertext with its `enc_meta`, opened only by a restore with the key.
    tables.push(
      tableOf(schema.invoiceAttachments, bundle.attachments.invoices, { references: { invoice_id: "invoices(id)" } }),
      tableOf(schema.expenseAttachments, bundle.attachments.expenses, { references: { expense_id: "expenses(id)" } }),
    );
  }
  if (bundle.vault) {
    tables.push(
      tableOf(schema.tenantVaults, [bundle.vault.settings], { primaryKey: "tenant_id" }),
      tableOf(schema.vaultKeyWraps, bundle.vault.wraps),
    );
  }
  return tables;
}

export const SQLITE_INDEXES = `CREATE INDEX invoice_line_items_invoice_id_idx ON invoice_line_items(invoice_id);`;
