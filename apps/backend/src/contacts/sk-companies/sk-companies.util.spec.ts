import type { RpoIndexRow } from "@faktur/cz-compliance";
import { describe, expect, it } from "vitest";
import { likeContains, likePrefix, skIndexUsable, SkWriteBuffer, sweepIsSafe } from "./sk-companies.util";

const NOW = new Date("2026-10-18T12:00:00Z");

describe("skIndexUsable", () => {
  it("needs a full load and data at most 10 days old", () => {
    expect(skIndexUsable({ initDate: "2026-10-03", dailyDate: "2026-10-17", rowCount: 1_040_000 }, NOW)).toBe(true);
    expect(skIndexUsable({ initDate: "2026-10-03", dailyDate: "2026-10-17", rowCount: 499_999 }, NOW)).toBe(false);
    expect(skIndexUsable({ initDate: "2026-10-03", dailyDate: null, rowCount: 1_040_000 }, NOW)).toBe(false);
    expect(skIndexUsable({ initDate: "2026-10-09", dailyDate: null, rowCount: 1_040_000 }, NOW)).toBe(true);
    expect(skIndexUsable({ initDate: null, dailyDate: null, rowCount: 1_040_000 }, NOW)).toBe(false);
    expect(skIndexUsable(null, NOW)).toBe(false);
  });

  it("goes by the newer of snapshot and delta", () => {
    // A daily older than the snapshot is the state right after a reload that failed half-way.
    expect(skIndexUsable({ initDate: "2026-10-15", dailyDate: "2026-09-30", rowCount: 1_040_000 }, NOW)).toBe(true);
  });
});

describe("like patterns", () => {
  it("take the needle's wildcards literally", () => {
    expect(likeContains("50% s.r.o")).toBe("%50\\% s.r.o%");
    expect(likeContains("a_b\\c")).toBe("%a\\_b\\\\c%");
    expect(likePrefix("100%_")).toBe("100\\%\\_%");
  });
});

describe("sweepIsSafe", () => {
  it("refuses a snapshot that is small or much smaller than the index", () => {
    expect(sweepIsSafe(1_000_000, 0)).toBe(true);
    expect(sweepIsSafe(1_000_000, 1_040_000)).toBe(true);
    expect(sweepIsSafe(800_000, 1_000_000)).toBe(true);
    expect(sweepIsSafe(799_999, 1_000_000)).toBe(false);
    expect(sweepIsSafe(400_000, 0)).toBe(false);
  });
});

const row = (rpoId: number, name = `Firma ${rpoId}`): RpoIndexRow => ({
  rpoId,
  ico: String(rpoId).padStart(8, "0"),
  name,
  nameNorm: name.toLowerCase(),
  street: null,
  city: null,
  postalCode: null,
  legalForm: null,
  establishedOn: null,
});
const up = (rpoId: number, name?: string) => ({ kind: "upsert" as const, row: row(rpoId, name) });
const rm = (rpoId: number) => ({ kind: "remove" as const, rpoId });
const shape = (ws: ReturnType<SkWriteBuffer["flush"]>) =>
  ws.map((w) => (w.kind === "upsert" ? `+${w.rows.map((r) => r.rpoId).join(",")}` : `-${w.rpoIds.join(",")}`));

describe("SkWriteBuffer", () => {
  it("keeps the file order between additions and removals", () => {
    const b = new SkWriteBuffer(100);
    const out = [up(1), up(2), rm(1), up(1), rm(3)].flatMap((e) => b.push(e));
    expect(shape([...out, ...b.flush()])).toEqual(["+1,2", "-1", "+1", "-3"]);
  });

  it("writes full chunks as they fill and keeps the last version of a subject", () => {
    const b = new SkWriteBuffer(3);
    expect(b.push(up(1, "A"))).toEqual([]);
    expect(b.push(up(1, "B"))).toEqual([]);
    expect(b.push(up(2))).toEqual([]);
    const full = b.push(up(3));
    expect(shape(full)).toEqual(["+1,2,3"]);
    expect(full[0]!.kind === "upsert" && full[0]!.rows[0]!.name).toBe("B");
    expect(b.flush()).toEqual([]);
  });
});
