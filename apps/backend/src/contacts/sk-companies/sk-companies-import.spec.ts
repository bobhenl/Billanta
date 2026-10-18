import type { RpoIndexRow } from "@faktur/cz-compliance";
import { describe, expect, it } from "vitest";
import { importSkCompanies, type SkCompaniesStore } from "./sk-companies-import";
import { SK_INDEX_MIN_ROWS } from "./sk-companies.util";

/** An in-memory `sk_companies` with a logical clock standing in for `synced_at`. */
function memoryStore(init: { initDate?: string | null; dailyDate?: string | null; rows?: number[]; locked?: boolean } = {}) {
  let clock = 0;
  const rows = new Map<number, { row: Partial<RpoIndexRow>; syncedAt: number }>();
  for (const id of init.rows ?? []) rows.set(id, { row: { rpoId: id }, syncedAt: clock });
  const state = { initDate: init.initDate ?? null, dailyDate: init.dailyDate ?? null, rowCount: 0, error: null as string | null };
  const store: SkCompaniesStore = {
    withLock: async (fn) => (init.locked ? "locked" : fn()),
    readState: async () => (state.initDate || state.dailyDate ? { initDate: state.initDate, dailyDate: state.dailyDate } : null),
    count: async () => rows.size,
    now: async () => new Date(++clock),
    upsert: async (rs) => {
      clock++;
      for (const r of rs) rows.set(r.rpoId, { row: r, syncedAt: clock });
    },
    remove: async (ids) => ids.filter((id) => rows.delete(id)).length,
    sweep: async (start) => {
      let n = 0;
      for (const [id, r] of rows) if (r.syncedAt < start.getTime()) n += +rows.delete(id);
      return n;
    },
    saveInit: async (date) => void Object.assign(state, { initDate: date, dailyDate: null }),
    saveDaily: async (date) => void (state.dailyDate = date),
    finish: async (n) => void Object.assign(state, { rowCount: n, error: null }),
    fail: async (msg) => void (state.error = msg),
  };
  return { store, rows, state };
}

const rec = (id: number, extra: Record<string, unknown> = {}) =>
  `,${JSON.stringify({ id, identifiers: [{ value: String(id).padStart(8, "0") }], fullNames: [{ value: `Firma ${id} s.r.o.` }], ...extra })}`;

/** A file in the export's own framing: header line, one record per line, footer. */
function file(...lines: (string | string[])[]) {
  const records = lines.flat().map((l, i) => (i === 0 ? l.slice(1) : l));
  return ['{"exportDate":"2026-10-17","results":[', ...records, "]}"];
}

function bucket(files: Record<string, string[]>) {
  const keys = Object.keys(files);
  return {
    listKeys: async () => keys,
    readLines: async function* (key: string) {
      yield* files[key] ?? [];
    },
  };
}

/** `n` ids starting at `from`. */
const range = (from: number, n: number) => Array.from({ length: n }, (_, i) => from + i);
const N = SK_INDEX_MIN_ROWS;

describe("importSkCompanies", () => {
  it("loads a snapshot, sweeps what it no longer has, then applies the deltas after it", async () => {
    // 1..N+1 loaded, the snapshot has 2..N+2: subject 1 disappeared from RPO.
    const { store, rows, state } = memoryStore({ initDate: "2026-09-06", dailyDate: "2026-10-02", rows: range(1, N + 1) });
    const r = await importSkCompanies(store, {
      ...bucket({
        "batch-init/init_2026-10-03_001.json.gz": file(range(2, N + 1).map((id) => rec(id)), rec(9_000_000, { termination: "2026-10-01" })),
        "batch-init/init_2026-10-03_list.txt": [],
        "batch-daily/actual_2026-10-02.json.gz": file(rec(5, { termination: "2026-10-02" })),
        "batch-daily/actual_2026-10-04.json.gz": file(rec(3, { termination: "2026-10-04" }), rec(9_000_001)),
      }),
    });
    expect(r).toMatchObject({ skipped: null, init: "2026-10-03", dailies: ["2026-10-04"], upserted: N + 2, removed: 1, swept: 1 });
    expect(rows.has(1)).toBe(false);
    expect(rows.has(3)).toBe(false);
    // The 10-02 delta is older than the snapshot and must not be replayed over it.
    expect(rows.has(5)).toBe(true);
    // A dissolved subject in a snapshot is skipped, not written.
    expect(rows.has(9_000_000)).toBe(false);
    expect(rows.has(9_000_001)).toBe(true);
    expect(state).toMatchObject({ initDate: "2026-10-03", dailyDate: "2026-10-04", rowCount: N + 1, error: null });
    expect(r.rowCount).toBe(N + 1);
  });

  it("stops before the sweep when the snapshot is far smaller than the index", async () => {
    const { store, rows, state } = memoryStore({ initDate: "2026-09-06", rows: range(1, N + 10) });
    const files = bucket({
      "batch-init/init_2026-10-03_001.json.gz": file(range(1, 1000).map((id) => rec(id))),
      "batch-init/init_2026-10-03_list.txt": [],
    });
    await expect(importSkCompanies(store, files)).rejects.toThrow(/not sweeping/);
    expect(rows.size).toBe(N + 10);
    expect(state.initDate).toBe("2026-09-06");
    expect(state.error).toMatch(/only 1000 active subjects/);
  });

  it("applies only the new deltas when the snapshot is loaded, removals included", async () => {
    const { store, rows, state } = memoryStore({ initDate: "2026-10-03", dailyDate: "2026-10-16", rows: [1, 2, 3] });
    const files = bucket({
      "batch-init/init_2026-10-03_001.json.gz": ["must not be read"],
      "batch-init/init_2026-10-03_list.txt": [],
      "batch-daily/actual_2026-10-16.json.gz": file(rec(1, { termination: "2026-10-16" })),
      "batch-daily/actual_2026-10-17.json.gz": file(rec(2, { termination: "2026-10-17" }), rec(4), rec(4, { fullNames: [{ value: "Nové meno s.r.o." }] })),
    });
    const r = await importSkCompanies(store, files);
    expect(r).toMatchObject({ init: null, dailies: ["2026-10-17"], upserted: 1, removed: 1, swept: 0, rowCount: 3 });
    expect([...rows.keys()].sort()).toEqual([1, 3, 4]);
    expect(rows.get(4)!.row.name).toBe("Nové meno s.r.o.");
    expect(state.dailyDate).toBe("2026-10-17");
  });

  it("reloads the loaded snapshot with --full", async () => {
    const { store } = memoryStore({ initDate: "2026-10-03", dailyDate: "2026-10-17", rows: range(1, N) });
    const r = await importSkCompanies(store, {
      full: true,
      ...bucket({
        "batch-init/init_2026-10-03_001.json.gz": file(range(1, N).map((id) => rec(id))),
        "batch-init/init_2026-10-03_list.txt": [],
        "batch-daily/actual_2026-10-17.json.gz": file(rec(7_000_000)),
      }),
    });
    expect(r).toMatchObject({ init: "2026-10-03", dailies: ["2026-10-17"], upserted: N + 1, swept: 0 });
  });

  it("resumes after the last delta a failed run got through", async () => {
    const { store, state } = memoryStore({ initDate: "2026-10-03", dailyDate: "2026-10-15", rows: [1] });
    const files = {
      "batch-init/init_2026-10-03_list.txt": [],
      "batch-daily/actual_2026-10-16.json.gz": file(rec(2)),
      "batch-daily/actual_2026-10-17.json.gz": file(rec(3)),
    };
    const broken = bucket(files);
    const readLines = async function* (key: string) {
      if (key.includes("10-17")) throw new Error("connection reset");
      yield* broken.readLines(key);
    };
    await expect(importSkCompanies(store, { listKeys: broken.listKeys, readLines })).rejects.toThrow("connection reset");
    expect(state).toMatchObject({ dailyDate: "2026-10-16", error: "connection reset" });

    const r = await importSkCompanies(store, bucket(files));
    expect(r.dailies).toEqual(["2026-10-17"]);
    expect(state.error).toBeNull();
  });

  it("does nothing while another import holds the lock", async () => {
    const { store, state } = memoryStore({ locked: true });
    const r = await importSkCompanies(store, { listKeys: async () => { throw new Error("must not list"); } });
    expect(r.skipped).toBe("locked");
    expect(state.error).toBeNull();
  });
});
