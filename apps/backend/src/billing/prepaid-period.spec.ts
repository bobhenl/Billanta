import { describe, expect, it } from "vitest";
import { addMonths, prepaidUntilAfterPayment } from "./prepaid-period";

describe("addMonths", () => {
  it("clamps to the end of a shorter month", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2028-01-31", 1)).toBe("2028-02-29");
    expect(addMonths("2026-03-31", 1)).toBe("2026-04-30");
    expect(addMonths("2026-05-31", 1)).toBe("2026-06-30");
  });

  it("keeps the day when the next month has it", () => {
    expect(addMonths("2026-01-30", 1)).toBe("2026-02-28");
    expect(addMonths("2026-01-28", 1)).toBe("2026-02-28");
    expect(addMonths("2026-02-28", 1)).toBe("2026-03-28");
    expect(addMonths("2026-04-30", 1)).toBe("2026-05-30");
  });

  it("adds a year across the year boundary, including from a leap day", () => {
    expect(addMonths("2026-10-17", 12)).toBe("2027-10-17");
    expect(addMonths("2026-12-15", 1)).toBe("2027-01-15");
    expect(addMonths("2026-12-31", 1)).toBe("2027-01-31");
    expect(addMonths("2028-02-29", 12)).toBe("2029-02-28");
  });

  it("counts several months at once from the start day, not month by month", () => {
    expect(addMonths("2026-01-31", 3)).toBe("2026-04-30");
    expect(addMonths("2026-11-30", 3)).toBe("2027-02-28");
  });
});

describe("prepaidUntilAfterPayment", () => {
  const today = "2026-10-18";
  const none = { prepaidPlan: null, prepaidUntil: null };

  it("starts a month or a year from today when nothing is prepaid", () => {
    expect(prepaidUntilAfterPayment(none, "plus", 1, today)).toBe("2026-11-18");
    expect(prepaidUntilAfterPayment(none, "plus", 12, today)).toBe("2027-10-18");
  });

  it("extends a running period of the same plan from its end", () => {
    expect(prepaidUntilAfterPayment({ prepaidPlan: "plus", prepaidUntil: "2026-10-31" }, "plus", 1, today)).toBe("2026-11-30");
    expect(prepaidUntilAfterPayment({ prepaidPlan: "plus", prepaidUntil: "2027-01-31" }, "plus", 1, today)).toBe("2027-02-28");
    // Paying on the last covered day loses nothing: its end and today are the same day.
    expect(prepaidUntilAfterPayment({ prepaidPlan: "plus", prepaidUntil: today }, "plus", 1, today)).toBe("2026-11-18");
  });

  it("starts from today after a lapsed period or for another plan", () => {
    expect(prepaidUntilAfterPayment({ prepaidPlan: "plus", prepaidUntil: "2026-10-17" }, "plus", 1, today)).toBe("2026-11-18");
    expect(prepaidUntilAfterPayment({ prepaidPlan: "start", prepaidUntil: "2026-12-31" }, "plus", 1, today)).toBe("2026-11-18");
  });
});
