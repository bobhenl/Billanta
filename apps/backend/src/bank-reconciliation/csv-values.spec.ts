import { describe, expect, it } from "vitest";
import { addAmounts, negateAmount, parseDate } from "./csv-values";

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe("parseDate", () => {
  it("puts a UTC timestamp on the Prague calendar day, not the UTC day", () => {
    // 23:30 UTC on 30 September is 01:30 on 1 October in Prague (CEST, +2).
    expect(parseDate("2026-09-30 23:30:00", { utc: true })).toEqual(day("2026-10-01"));
    // Winter time is +1: 22:59 UTC is still the same day, 23:00 is the next.
    expect(parseDate("2026-12-31 22:59:59", { utc: true })).toEqual(day("2026-12-31"));
    expect(parseDate("2026-12-31T23:00:00.000Z")).toEqual(day("2027-01-01"));
  });

  it("honours an explicit offset", () => {
    expect(parseDate("2026-07-01T00:30:00+02:00")).toEqual(day("2026-07-01"));
    expect(parseDate("2026-06-30T23:30:00-01:00")).toEqual(day("2026-07-01"));
  });

  it("keeps the written day for a timestamp of unknown zone", () => {
    expect(parseDate("2026-09-30 23:30:00")).toEqual(day("2026-09-30"));
    expect(parseDate("30.09.2026 23:30")).toEqual(day("2026-09-30"));
  });

  it("reads DD-MM-YYYY with or without a time, and English month names", () => {
    expect(parseDate("30-09-2026")).toEqual(day("2026-09-30"));
    expect(parseDate("30-09-2026 22:15:00.000", { utc: true })).toEqual(day("2026-10-01"));
    expect(parseDate("15 Jan 2019")).toEqual(day("2019-01-15"));
    expect(parseDate("Jan 15, 2019")).toEqual(day("2019-01-15"));
  });

  it("rejects impossible dates and times", () => {
    expect(parseDate("31-02-2026")).toBeNull();
    expect(parseDate("2026-09-30 25:00:00", { utc: true })).toBeNull();
    expect(parseDate("09/30/2026")).toBeNull();
  });
});

describe("amount arithmetic", () => {
  it("adds and negates without float drift", () => {
    expect(addAmounts("0.10", "0.20")).toBe("0.30");
    expect(addAmounts("1209.60", "0.40")).toBe("1210.00");
    expect(negateAmount("501.20")).toBe("-501.20");
    expect(negateAmount("0.00")).toBe("0.00");
  });
});
