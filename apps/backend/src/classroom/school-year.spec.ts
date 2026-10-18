import { describe, expect, it } from "vitest";
import { defaultClassEnd, nextSchoolYearEnd, validClassEnd } from "./school-year";

describe("school year", () => {
  it("ends the current school year until June", () => {
    expect(defaultClassEnd(new Date("2026-10-19T10:00:00Z")).toISOString()).toBe("2027-08-31T21:59:59.000Z");
    expect(defaultClassEnd(new Date("2027-06-30T10:00:00Z")).toISOString()).toBe("2027-08-31T21:59:59.000Z");
  });

  it("plans the coming year from July", () => {
    expect(defaultClassEnd(new Date("2027-07-01T10:00:00Z")).toISOString()).toBe("2028-08-31T21:59:59.000Z");
  });

  it("allows end dates up to 13 months ahead", () => {
    const now = new Date("2026-10-19T10:00:00Z");
    expect(validClassEnd(new Date("2027-08-31T00:00:00Z"), now)).toBe(true);
    expect(validClassEnd(new Date("2027-12-01T00:00:00Z"), now)).toBe(false);
    expect(validClassEnd(new Date("2026-10-18T00:00:00Z"), now)).toBe(false);
  });

  it("extends by one school year", () => {
    const now = new Date("2027-08-20T10:00:00Z");
    expect(nextSchoolYearEnd(new Date("2027-08-31T21:59:59Z"), now).toISOString()).toBe("2028-08-31T21:59:59.000Z");
    // A class that already ended gets the year that is starting.
    expect(nextSchoolYearEnd(new Date("2027-06-30T21:59:59Z"), new Date("2027-09-10T10:00:00Z")).toISOString()).toBe("2028-08-31T21:59:59.000Z");
  });
});
