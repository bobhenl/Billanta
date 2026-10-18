import type { RpoBatchEntry, RpoIndexRow } from "@faktur/cz-compliance";

/** Import progress as stored in `sk_companies_sync`. */
export interface SkSyncState {
  initDate: string | null;
  dailyDate: string | null;
  rowCount: number;
}

/**
 * Below this the table is a partial or failed load, not the register: about
 * 1.04 M subjects were active in the October 2026 snapshot.
 */
export const SK_INDEX_MIN_ROWS = 500_000;
/**
 * Data older than this sends searches back to live RPO. The deltas come
 * nightly, so 10 days means the cron or the export has been broken for a
 * week; until then a slightly old index still beats a 7 s live search
 * (only companies founded in the last days would be missing).
 */
export const SK_INDEX_MAX_AGE_DAYS = 10;

/** Whether searches may trust the local index instead of asking RPO live. */
export function skIndexUsable(state: SkSyncState | null, now = new Date()): boolean {
  if (!state || state.rowCount < SK_INDEX_MIN_ROWS) return false;
  const dataDate = [state.initDate, state.dailyDate].filter((d): d is string => !!d).sort().pop();
  if (!dataDate) return false;
  const ageDays = (now.getTime() - Date.parse(`${dataDate}T00:00:00Z`)) / 86_400_000;
  return ageDays <= SK_INDEX_MAX_AGE_DAYS;
}

/** `LIKE` pattern for "contains", with the needle's own `%`, `_` and `\` taken literally. */
export const likeContains = (needle: string): string => `%${needle.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
export const likePrefix = (needle: string): string => `${needle.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

/**
 * Whether a finished snapshot may delete the rows it did not touch. A
 * snapshot far smaller than what is loaded is a broken export (or a
 * download cut short in a way that looked like a clean end), and sweeping
 * after it would empty the index, so the import stops instead.
 */
export function sweepIsSafe(seen: number, before: number): boolean {
  return seen >= SK_INDEX_MIN_ROWS && seen >= before * 0.8;
}

/** A run of same-kind writes, in file order. */
export type SkWrite = { kind: "upsert"; rows: RpoIndexRow[] } | { kind: "remove"; rpoIds: number[] };

/**
 * Groups batch entries into chunks for bulk writes while keeping file
 * order between upserts and removals (a delta can add a subject and then
 * dissolve it). Within an upsert chunk the last version of a subject wins,
 * since one `INSERT … ON CONFLICT` cannot touch the same row twice.
 */
export class SkWriteBuffer {
  private kind: "upsert" | "remove" | null = null;
  private upserts = new Map<number, RpoIndexRow>();
  private removes = new Set<number>();

  constructor(private readonly chunkSize = 1000) {}

  /** Adds an entry; returns the chunks that are ready to write. */
  push(entry: RpoBatchEntry): SkWrite[] {
    const out: SkWrite[] = [];
    if (this.kind !== null && this.kind !== entry.kind) out.push(...this.flush());
    this.kind = entry.kind;
    if (entry.kind === "upsert") this.upserts.set(entry.row.rpoId, entry.row);
    else this.removes.add(entry.rpoId);
    if (this.upserts.size + this.removes.size >= this.chunkSize) out.push(...this.flush());
    return out;
  }

  flush(): SkWrite[] {
    const out: SkWrite[] = [];
    if (this.upserts.size > 0) out.push({ kind: "upsert", rows: [...this.upserts.values()] });
    if (this.removes.size > 0) out.push({ kind: "remove", rpoIds: [...this.removes] });
    this.upserts = new Map();
    this.removes = new Set();
    this.kind = null;
    return out;
  }
}
