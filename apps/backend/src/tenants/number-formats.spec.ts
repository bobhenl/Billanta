import { beforeEach, describe, expect, it, vi } from "vitest";

const lastSequence = vi.fn();
const bumpInvoiceSequences = vi.fn();
vi.mock("../invoices/invoice-numbering.util", async (original) => ({
  ...(await original<typeof import("../invoices/invoice-numbering.util")>()),
  lastSequence: (...args: unknown[]) => lastSequence(...args),
  bumpInvoiceSequences: (...args: unknown[]) => bumpInvoiceSequences(...args),
}));

import { mergeNumberFormats, periodRange, setNextNumber } from "./number-formats";

describe("mergeNumberFormats", () => {
  it("sets, keeps and clears patterns per type", () => {
    const merged = mergeNumberFormats({ invoice: "{N}/{MM}/{YYYY}", proforma: "ZF{YYYY}{NNN}" }, { invoice: "FV{YYYY}{NNNN}", proforma: null });
    expect(merged).toEqual({ invoice: "FV{YYYY}{NNNN}" });
  });

  it("leaves out types the input does not mention", () => {
    expect(mergeNumberFormats({ quote: "NA{YY}{NNN}" }, {})).toEqual({ quote: "NA{YY}{NNN}" });
  });
});

describe("periodRange", () => {
  it("covers a whole year for the yearly counter and one month for a monthly one", () => {
    expect(periodRange(2026, 0)).toEqual({ from: new Date(2026, 0, 1), to: new Date(2027, 0, 1) });
    expect(periodRange(2026, 10)).toEqual({ from: new Date(2026, 9, 1), to: new Date(2026, 10, 1) });
    expect(periodRange(2026, 12)).toEqual({ from: new Date(2026, 11, 1), to: new Date(2027, 0, 1) });
  });
});

describe("setNextNumber", () => {
  const now = new Date(2026, 9, 16);
  const dbWith = (issuedInPeriod: number) => {
    const where = vi.fn(async () => [{ n: issuedInPeriod }]);
    const execute = vi.fn(async () => undefined);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { db: { select: () => ({ from: () => ({ where }) }), execute } as any, execute };
  };

  beforeEach(() => {
    lastSequence.mockReset();
    bumpInvoiceSequences.mockReset();
  });

  it("raises the counter of the pattern's current period", async () => {
    lastSequence.mockResolvedValue(3);
    const { db, execute } = dbWith(0);
    await setNextNumber(db, "t1", "invoice", "{N}/{MM}/{YYYY}", 10, now);
    expect(lastSequence).toHaveBeenCalledWith(db, "t1", "", 2026, 10);
    expect(bumpInvoiceSequences).toHaveBeenCalledWith(db, "t1", [{ series: "", year: 2026, month: 10, sequence: 9 }]);
    expect(execute).not.toHaveBeenCalled();
  });

  it("does nothing when the next number is already that", async () => {
    lastSequence.mockResolvedValue(9);
    const { db, execute } = dbWith(5);
    await setNextNumber(db, "t1", "invoice", "{N}/{MM}/{YYYY}", 10, now);
    expect(bumpInvoiceSequences).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  it("lowers the counter only while the period has no issued document", async () => {
    lastSequence.mockResolvedValue(9);
    const empty = dbWith(0);
    await setNextNumber(empty.db, "t1", "proforma", "ZF{YYYY}{NNN}", 2, now);
    expect(empty.execute).toHaveBeenCalledTimes(1);

    const used = dbWith(1);
    await expect(setNextNumber(used.db, "t1", "proforma", "ZF{YYYY}{NNN}", 2, now)).rejects.toMatchObject({
      response: { error: "next_number_too_low", type: "proforma", minimum: 10 },
    });
    expect(used.execute).not.toHaveBeenCalled();
  });
});
