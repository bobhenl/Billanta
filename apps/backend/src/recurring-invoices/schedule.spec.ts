import { describe, expect, it } from "vitest";
import { advanceNextRunDate, isTemplateDue } from "./schedule";

describe("advanceNextRunDate", () => {
  it("advances weekly by 7 x intervalCount days", () => {
    expect(advanceNextRunDate(new Date("2026-01-01T00:00:00.000Z"), "weekly", 1)).toEqual(
      new Date("2026-01-08T00:00:00.000Z"),
    );
    expect(advanceNextRunDate(new Date("2026-01-01T00:00:00.000Z"), "weekly", 3)).toEqual(
      new Date("2026-01-22T00:00:00.000Z"),
    );
  });

  it("advances monthly by intervalCount months", () => {
    expect(advanceNextRunDate(new Date("2026-01-15T00:00:00.000Z"), "monthly", 1)).toEqual(
      new Date("2026-02-15T00:00:00.000Z"),
    );
    expect(advanceNextRunDate(new Date("2026-01-15T00:00:00.000Z"), "monthly", 2)).toEqual(
      new Date("2026-03-15T00:00:00.000Z"),
    );
  });

  it("wraps monthly across a year boundary", () => {
    expect(advanceNextRunDate(new Date("2026-11-30T00:00:00.000Z"), "monthly", 2)).toEqual(
      new Date("2027-01-30T00:00:00.000Z"),
    );
  });

  it("advances quarterly as 3 x intervalCount months", () => {
    expect(advanceNextRunDate(new Date("2026-01-15T00:00:00.000Z"), "quarterly", 1)).toEqual(
      new Date("2026-04-15T00:00:00.000Z"),
    );
    expect(advanceNextRunDate(new Date("2026-01-15T00:00:00.000Z"), "quarterly", 2)).toEqual(
      new Date("2026-07-15T00:00:00.000Z"),
    );
  });

  it("advances yearly by intervalCount years", () => {
    expect(advanceNextRunDate(new Date("2026-01-15T00:00:00.000Z"), "yearly", 1)).toEqual(
      new Date("2027-01-15T00:00:00.000Z"),
    );
    expect(advanceNextRunDate(new Date("2026-01-15T00:00:00.000Z"), "yearly", 3)).toEqual(
      new Date("2029-01-15T00:00:00.000Z"),
    );
  });

  it("handles a leap-year Feb 29 advanced by one year landing on a non-leap year", () => {
    // 2028 is a leap year (Feb 29 exists); 2029 is not, so native Date
    // rolls Feb 29 2028 + 1 year over into Mar 1 2029 — documented, not a bug.
    const result = advanceNextRunDate(new Date("2028-02-29T00:00:00.000Z"), "yearly", 1);
    expect(result.toISOString()).toBe("2029-03-01T00:00:00.000Z");
  });

  it("documents native month-overflow when the target month is shorter (Jan 31 + 1 month)", () => {
    const result = advanceNextRunDate(new Date("2026-01-31T00:00:00.000Z"), "monthly", 1);
    // Non-leap 2026: Feb has 28 days, so Jan 31 + 1 month rolls into March.
    expect(result.getUTCMonth()).toBe(2); // March, 0-indexed
  });

  it("does not mutate the input date", () => {
    const input = new Date("2026-01-01T00:00:00.000Z");
    const copy = new Date(input.getTime());
    advanceNextRunDate(input, "monthly", 1);
    expect(input).toEqual(copy);
  });

  it("throws on an unrecognized frequency instead of silently no-op-ing", () => {
    expect(() =>
      advanceNextRunDate(new Date("2026-01-01T00:00:00.000Z"), "biweekly" as never, 1),
    ).toThrow(/unknown recurring frequency/i);
  });
});

describe("isTemplateDue", () => {
  const asOf = new Date("2026-09-09T00:00:00.000Z");

  it("is due when nextRunDate is exactly asOf", () => {
    expect(isTemplateDue({ isActive: true, nextRunDate: asOf }, asOf)).toBe(true);
  });

  it("is due when nextRunDate is in the past", () => {
    expect(
      isTemplateDue({ isActive: true, nextRunDate: new Date("2026-09-01T00:00:00.000Z") }, asOf),
    ).toBe(true);
  });

  it("is not due when nextRunDate is in the future", () => {
    expect(
      isTemplateDue({ isActive: true, nextRunDate: new Date("2026-09-10T00:00:00.000Z") }, asOf),
    ).toBe(false);
  });

  it("is never due when isActive is false, even if nextRunDate is overdue", () => {
    expect(
      isTemplateDue({ isActive: false, nextRunDate: new Date("2020-01-01T00:00:00.000Z") }, asOf),
    ).toBe(false);
  });

  it("compares by UTC calendar day only, ignoring time-of-day", () => {
    // asOf carries a non-midnight time; nextRunDate is midnight the same day.
    const laterSameDay = new Date("2026-09-09T23:59:59.000Z");
    expect(isTemplateDue({ isActive: true, nextRunDate: asOf }, laterSameDay)).toBe(true);
    const earlierSameDay = new Date("2026-09-09T00:00:01.000Z");
    expect(isTemplateDue({ isActive: true, nextRunDate: asOf }, earlierSameDay)).toBe(true);
  });

  it("only picks up the subset of templates that are both active and due", () => {
    const templates = [
      { id: "a", isActive: true, nextRunDate: new Date("2026-09-01T00:00:00.000Z") }, // due
      { id: "b", isActive: true, nextRunDate: new Date("2026-12-01T00:00:00.000Z") }, // not due yet
      { id: "c", isActive: false, nextRunDate: new Date("2020-01-01T00:00:00.000Z") }, // inactive
      { id: "d", isActive: true, nextRunDate: asOf }, // due today
    ];

    const due = templates.filter((t) => isTemplateDue(t, asOf)).map((t) => t.id);

    expect(due).toEqual(["a", "d"]);
  });
});
