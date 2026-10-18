import { beforeEach, describe, expect, it, vi } from "vitest";

// Made-up month-end lists: EUR on the last day of month m (0-based) is 24 + m / 10.
const cnb = vi.hoisted(() => ({
  getCnbDay: vi.fn(async (d: Date) => ({
    date: d.toISOString().slice(0, 10),
    rates: new Map([
      ["EUR", { rate: 24 + d.getMonth() / 10, country: "EMU", name: "euro" }],
      ["USD", { rate: 22, country: "USA", name: "dolar" }],
    ]),
  })),
}));
vi.mock("./cnb-rates", () => cnb);

import { computeUniformRates, finishedMonthEnds, ReportRates, uniformRateOf } from "./uniform-rate";

describe("uniformRateOf", () => {
  it("averages twelve month-end rates and marks the result final", () => {
    const rates = [25.1, 25.2, 25.3, 25.0, 24.9, 24.8, 24.7, 24.6, 24.5, 24.4, 24.3, 24.2];
    expect(uniformRateOf(rates)).toEqual({ rate: 24.75, months: 12, final: true });
  });
  it("gives a running value from the months known so far", () => {
    expect(uniformRateOf([25, 26, 24.4, null, null])).toEqual({ rate: 25.1333, months: 3, final: false });
  });
  it("skips months it could not load and is null with none", () => {
    expect(uniformRateOf([null, 0, Number.NaN, 20])).toEqual({ rate: 20, months: 1, final: false });
    expect(uniformRateOf([])).toBeNull();
    expect(uniformRateOf([null, undefined])).toBeNull();
  });
});

describe("finishedMonthEnds", () => {
  it("lists the last day of every month of a past year", () => {
    const days = finishedMonthEnds(2025, new Date(2026, 9, 17));
    expect(days).toHaveLength(12);
    expect(days[1]).toEqual(new Date(2025, 1, 28));
    expect(days[11]).toEqual(new Date(2025, 11, 31));
  });
  it("only the months that are over in the current year", () => {
    expect(finishedMonthEnds(2026, new Date(2026, 9, 17))).toHaveLength(9);
    // The last day itself is not over yet.
    expect(finishedMonthEnds(2026, new Date(2026, 9, 31))).toHaveLength(9);
    expect(finishedMonthEnds(2026, new Date(2026, 10, 1))).toHaveLength(10);
  });
  it("nothing for a future year", () => {
    expect(finishedMonthEnds(2027, new Date(2026, 9, 17))).toEqual([]);
  });
});

describe("computeUniformRates", () => {
  beforeEach(() => {
    cnb.getCnbDay.mockClear();
  });
  it("asks ČNB for each month end and averages per currency", async () => {
    const rates = await computeUniformRates(2025, new Date(2026, 0, 5));
    expect(cnb.getCnbDay).toHaveBeenCalledTimes(12);
    // (24.0 + 24.1 + … + 25.1) / 12
    expect(rates.get("EUR")).toEqual({ rate: 24.55, months: 12, final: true });
    expect(rates.get("USD")).toEqual({ rate: 22, months: 12, final: true });
  });
  it("a running year counts only finished months", async () => {
    const rates = await computeUniformRates(2026, new Date(2026, 3, 10));
    expect(rates.get("EUR")).toEqual({ rate: 24.1, months: 3, final: false });
  });
});

describe("ReportRates", () => {
  const day = new Date("2025-06-15T10:00:00Z");
  it("daily: the document's own rate, never ČNB", async () => {
    cnb.getCnbDay.mockClear();
    const r = new ReportRates(false, [], new Date(2026, 0, 5));
    expect(await r.rate("EUR", 25.3, day)).toBe(25.3);
    expect(await r.rate("EUR", null, day)).toBeNull();
    expect(await r.rate("CZK", null, day)).toBe(1);
    expect(cnb.getCnbDay).not.toHaveBeenCalled();
  });
  it("annual: the company's own rate for the year wins over the computed one", async () => {
    const r = new ReportRates(true, [{ year: 2025, currency: "EUR", rate: 25.01 }], new Date(2026, 0, 5));
    expect(await r.rate("EUR", 25.3, day)).toBe(25.01);
    expect(await r.rate("USD", 23, day)).toBe(22);
  });
  it("annual: the year can be given (a tax year's summary)", async () => {
    const r = new ReportRates(true, [{ year: 2024, currency: "EUR", rate: 25.16 }], new Date(2026, 0, 5));
    expect(await r.rate("EUR", 25.3, day, 2024)).toBe(25.16);
  });
  it("annual: falls back to the document's rate when no month is known", async () => {
    const r = new ReportRates(true, [], new Date(2026, 0, 5));
    expect(await r.rate("EUR", 25.3, new Date("2026-01-03T10:00:00Z"))).toBe(25.3);
  });
  it("reads the old single 'annual' setting as annual reports", () => {
    expect(ReportRates.fromPrefs({ exchangeRateMode: "annual" }).annual).toBe(true);
    expect(ReportRates.fromPrefs({ exchangeRateMode: "annual", reportRateMode: "daily" }).annual).toBe(false);
    expect(ReportRates.fromPrefs({}).annual).toBe(false);
  });
});
