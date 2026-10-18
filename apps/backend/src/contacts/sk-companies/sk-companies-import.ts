import {
  listRpoBatchKeys,
  parseRpoBatchLine,
  planRpoSync,
  readRpoBatchLines,
  rpoBatchEntryOf,
  type RpoIndexRow,
} from "@faktur/cz-compliance";
import type postgres from "postgres";
import { SkWriteBuffer, sweepIsSafe, type SkWrite } from "./sk-companies.util";

type Sql = ReturnType<typeof postgres>;

/** The database side of the import, kept narrow so the import logic is testable without Postgres. */
export interface SkCompaniesStore {
  /** Runs `fn` holding a lock, so the cron and the CLI never import at the same time; "locked" when someone else holds it. */
  withLock<T>(fn: () => Promise<T>): Promise<T | "locked">;
  readState(): Promise<{ initDate: string | null; dailyDate: string | null } | null>;
  count(): Promise<number>;
  now(): Promise<Date>;
  upsert(rows: RpoIndexRow[]): Promise<void>;
  remove(rpoIds: number[]): Promise<number>;
  /** Deletes rows the current snapshot did not touch (synced before `start`). */
  sweep(start: Date): Promise<number>;
  saveInit(date: string): Promise<void>;
  saveDaily(date: string): Promise<void>;
  finish(rowCount: number): Promise<void>;
  fail(message: string): Promise<void>;
}

export interface SkImportResult {
  skipped: "locked" | null;
  init: string | null;
  dailies: string[];
  upserted: number;
  removed: number;
  swept: number;
  rowCount: number;
}

export interface SkImportOptions {
  /** Reload the newest snapshot even if it is already loaded. */
  full?: boolean;
  log?: (message: string) => void;
  listKeys?: () => Promise<string[]>;
  readLines?: (key: string) => AsyncIterable<string>;
}

/**
 * Brings `sk_companies` up to date with the RPO bulk export: the newest
 * monthly snapshot when it is newer than the loaded one (then a sweep of the
 * subjects it no longer has), and the nightly deltas after it. Streams one
 * line at a time and writes in chunks of 1000, so memory stays flat (about
 * 200 MB RSS for the full 9.8 GB of JSON) whatever the file size.
 * Idempotent: every write is an upsert or a delete by RPO id, and progress
 * is saved after each file, so a run that dies is resumed by the next one.
 */
export async function importSkCompanies(store: SkCompaniesStore, opts: SkImportOptions = {}): Promise<SkImportResult> {
  const log = opts.log ?? (() => undefined);
  const result: SkImportResult = { skipped: null, init: null, dailies: [], upserted: 0, removed: 0, swept: 0, rowCount: 0 };
  const outcome = await store.withLock(async () => {
    try {
      const state = opts.full ? null : await store.readState();
      const keys = await (opts.listKeys ?? listRpoBatchKeys)();
      const plan = planRpoSync(keys, { initDate: state?.initDate ?? null, dailyDate: state?.dailyDate ?? null });
      const readLines = opts.readLines ?? ((key: string) => readRpoBatchLines(key));

      const write = async (w: SkWrite) => {
        if (w.kind === "upsert") {
          await store.upsert(w.rows);
          result.upserted += w.rows.length;
        } else {
          result.removed += await store.remove(w.rpoIds);
        }
      };
      // In a snapshot a dissolved subject is simply absent from the active set: the sweep removes it.
      const applyFile = async (key: string, applyRemovals: boolean) => {
        const buffer = new SkWriteBuffer();
        for await (const line of readLines(key)) {
          const record = parseRpoBatchLine(line);
          if (!record) continue;
          const entry = rpoBatchEntryOf(record);
          if (entry.kind === "remove" && !applyRemovals) continue;
          for (const w of buffer.push(entry)) await write(w);
        }
        for (const w of buffer.flush()) await write(w);
      };

      if (plan.init) {
        const before = await store.count();
        const start = await store.now();
        for (const key of plan.init.keys) {
          log(`sk-companies: ${key}`);
          await applyFile(key, false);
        }
        if (!sweepIsSafe(result.upserted, before)) {
          throw new Error(`snapshot ${plan.init.date} has only ${result.upserted} active subjects (index has ${before}); not sweeping`);
        }
        result.swept = await store.sweep(start);
        await store.saveInit(plan.init.date);
        result.init = plan.init.date;
      }
      for (const daily of plan.dailies) {
        log(`sk-companies: ${daily.key}`);
        await applyFile(daily.key, true);
        await store.saveDaily(daily.date);
        result.dailies.push(daily.date);
      }
      result.rowCount = await store.count();
      await store.finish(result.rowCount);
      return result;
    } catch (err) {
      await store.fail((err as Error).message.slice(0, 500)).catch(() => undefined);
      throw err;
    }
  });
  if (outcome === "locked") return { ...result, skipped: "locked" };
  return outcome;
}

/** Arbitrary constant naming the import's session-level advisory lock. */
const SK_IMPORT_LOCK = 734_120_581;

const toDb = (r: RpoIndexRow) => ({
  rpo_id: r.rpoId,
  ico: r.ico,
  name: r.name,
  name_norm: r.nameNorm,
  street: r.street,
  city: r.city,
  postal_code: r.postalCode?.slice(0, 10) ?? null,
  legal_form: r.legalForm?.slice(0, 3) ?? null,
  established_on: r.establishedOn,
});

/** `SkCompaniesStore` over postgres.js; the tables are global (no RLS), see migration 0058. */
export function pgSkCompaniesStore(sql: Sql): SkCompaniesStore {
  return {
    async withLock(fn) {
      // A session-level lock needs one fixed connection for lock and unlock.
      const conn = await sql.reserve();
      try {
        const [row] = await conn<{ locked: boolean }[]>`SELECT pg_try_advisory_lock(${SK_IMPORT_LOCK}) AS locked`;
        if (!row?.locked) return "locked";
        try {
          return await fn();
        } finally {
          await conn`SELECT pg_advisory_unlock(${SK_IMPORT_LOCK})`;
        }
      } finally {
        conn.release();
      }
    },
    async readState() {
      const [row] = await sql<{ init_date: string | null; daily_date: string | null }[]>`
        SELECT init_date::text, daily_date::text FROM sk_companies_sync WHERE id = 1`;
      return row ? { initDate: row.init_date, dailyDate: row.daily_date } : null;
    },
    async count() {
      const [row] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM sk_companies`;
      return row?.n ?? 0;
    },
    async now() {
      const [row] = await sql<{ now: Date }[]>`SELECT now() AS now`;
      return row!.now;
    },
    async upsert(rows) {
      if (rows.length === 0) return;
      await sql`
        INSERT INTO sk_companies ${sql(rows.map(toDb))}
        ON CONFLICT (rpo_id) DO UPDATE SET
          ico = excluded.ico, name = excluded.name, name_norm = excluded.name_norm,
          street = excluded.street, city = excluded.city, postal_code = excluded.postal_code,
          legal_form = excluded.legal_form, established_on = excluded.established_on,
          synced_at = now()`;
    },
    async remove(rpoIds) {
      if (rpoIds.length === 0) return 0;
      return (await sql`DELETE FROM sk_companies WHERE rpo_id IN ${sql(rpoIds)}`).count;
    },
    async sweep(start) {
      return (await sql`DELETE FROM sk_companies WHERE synced_at < ${start}`).count;
    },
    async saveInit(date) {
      await sql`
        INSERT INTO sk_companies_sync (id, init_date, daily_date) VALUES (1, ${date}, NULL)
        ON CONFLICT (id) DO UPDATE SET init_date = excluded.init_date, daily_date = NULL`;
    },
    async saveDaily(date) {
      await sql`
        INSERT INTO sk_companies_sync (id, daily_date) VALUES (1, ${date})
        ON CONFLICT (id) DO UPDATE SET daily_date = excluded.daily_date`;
    },
    async finish(rowCount) {
      await sql`
        INSERT INTO sk_companies_sync (id, row_count, finished_at, last_error) VALUES (1, ${rowCount}, now(), NULL)
        ON CONFLICT (id) DO UPDATE SET row_count = excluded.row_count, finished_at = excluded.finished_at, last_error = NULL`;
    },
    async fail(message) {
      await sql`
        INSERT INTO sk_companies_sync (id, last_error) VALUES (1, ${message})
        ON CONFLICT (id) DO UPDATE SET last_error = excluded.last_error`;
    },
  };
}
