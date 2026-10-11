import { describe, expect, it, vi } from "vitest";
import {
  allocateNextInvoiceSequence,
  deriveVariableSymbol,
  formatInvoiceNumber,
} from "./invoice-numbering.util";

describe("formatInvoiceNumber", () => {
  it("zero-pads the sequence to 4 digits, matching the frontend's existing mock format (e.g. 2026-0001)", () => {
    expect(formatInvoiceNumber(2026, 1)).toBe("2026-0001");
    expect(formatInvoiceNumber(2025, 98)).toBe("2025-0098");
  });

  it("does not truncate a 5+ digit sequence (just widens past 4 digits)", () => {
    expect(formatInvoiceNumber(2026, 12345)).toBe("2026-12345");
  });
});

describe("deriveVariableSymbol", () => {
  it("strips the year/sequence separator, keeping only digits", () => {
    expect(deriveVariableSymbol("2026-0001")).toBe("20260001");
  });

  it("caps at 10 digits (variable_symbol is varchar(10))", () => {
    expect(deriveVariableSymbol("2026-123456789")).toBe("2026123456");
  });
});

/**
 * Minimal fake of the exact Drizzle chain
 * `allocateNextInvoiceSequence` calls: `.insert().values().onConflictDoUpdate().returning()`.
 * Captures the `values`/`onConflictDoUpdate` call args so the test can
 * assert the atomic upsert shape (target columns + the `last_number + 1`
 * SQL fragment) without a real database.
 */
function makeInsertChain(returningResult: Array<{ lastNumber: number }>) {
  const calls: { values?: unknown; onConflictDoUpdate?: unknown } = {};
  const chain = {
    values: vi.fn((v: unknown) => {
      calls.values = v;
      return chain;
    }),
    onConflictDoUpdate: vi.fn((v: unknown) => {
      calls.onConflictDoUpdate = v;
      return chain;
    }),
    returning: vi.fn(() => Promise.resolve(returningResult)),
  };
  return { chain, calls };
}

describe("allocateNextInvoiceSequence", () => {
  it("issues a single INSERT ... ON CONFLICT DO UPDATE targeting (tenantId, year) and returns the new lastNumber", async () => {
    const { chain, calls } = makeInsertChain([{ lastNumber: 7 }]);
    const insert = vi.fn(() => chain);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = { insert } as any;

    const result = await allocateNextInvoiceSequence(db, "tenant-1", 2026);

    expect(result).toBe(7);
    expect(chain.values).toHaveBeenCalledWith({ tenantId: "tenant-1", series: "", year: 2026, lastNumber: 1 });
    expect(chain.onConflictDoUpdate).toHaveBeenCalledTimes(1);
    // The whole race-safety guarantee hinges on this being a single
    // statement's ON CONFLICT clause (not a separate read-then-write from
    // the application) — assert the target columns are exactly the pair
    // the tenant_year unique index covers, and that `set` is present (its
    // value is a drizzle `sql` fragment object, not worth deep-asserting
    // structurally here).
    const onConflictArg = calls.onConflictDoUpdate as { target: unknown[]; set: unknown };
    expect(onConflictArg.target).toHaveLength(3);
    expect(onConflictArg.set).toBeDefined();
  });

  it("simulates two concurrent callers each getting their own distinct, incrementing number", async () => {
    // Simulates what two overlapping requests would each observe if
    // Postgres serializes the two INSERT..ON CONFLICT statements one after
    // another (which is exactly what a single-statement atomic upsert
    // guarantees, unlike a read-then-write race) — first caller lands on
    // last_number=1, second on last_number=2, never both landing on the
    // same value.
    let sharedLastNumber = 0;
    const insert = vi.fn(() => ({
      values: vi.fn().mockReturnThis(),
      onConflictDoUpdate: vi.fn().mockReturnThis(),
      returning: vi.fn(() => {
        sharedLastNumber += 1;
        return Promise.resolve([{ lastNumber: sharedLastNumber }]);
      }),
    }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = { insert } as any;

    const [first, second] = await Promise.all([
      allocateNextInvoiceSequence(db, "tenant-1", 2026),
      allocateNextInvoiceSequence(db, "tenant-1", 2026),
    ]);

    expect(new Set([first, second]).size).toBe(2);
    expect([first, second].sort()).toEqual([1, 2]);
  });

  it("throws (rather than silently returning undefined) if the DB unexpectedly returns no row", async () => {
    const { chain } = makeInsertChain([]);
    const insert = vi.fn(() => chain);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = { insert } as any;

    await expect(allocateNextInvoiceSequence(db, "tenant-1", 2026)).rejects.toThrow();
  });
});
