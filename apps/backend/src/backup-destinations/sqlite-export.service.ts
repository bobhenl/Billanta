import { randomUUID } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Injectable } from "@nestjs/common";
import Database from "better-sqlite3";
import type { ExportBundle } from "./export.service";
import { SQLITE_INDEXES, sqliteLayout, type SqliteTable } from "./sqlite-layout";

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
   * recurring templates, the Confidential-mode key check and recovery wrap,
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
        const tables = sqliteLayout(bundle);
        this.createSchema(db, tables);
        this.insertData(db, tables);
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
   * One table per bundle part with every column of the Postgres table
   * (`sqlite-layout.ts`), so the file restores with the sealed amounts'
   * envelopes and whatever columns later migrations add.
   */
  private createSchema(db: InstanceType<typeof Database>, tables: SqliteTable[]): void {
    db.exec(`${tables.map((t) => t.ddl).join(";\n")};\n${SQLITE_INDEXES}`);
  }

  private insertData(db: InstanceType<typeof Database>, tables: SqliteTable[]): void {
    for (const table of tables) {
      if (!table.rows.length) continue;
      const insert = db.prepare(
        `INSERT INTO "${table.name}" (${table.columns.map((c) => `"${c}"`).join(", ")}) VALUES (${table.columns.map(() => "?").join(", ")})`,
      );
      db.transaction(() => {
        for (const row of table.rows) insert.run(...row);
      })();
    }
  }
}
