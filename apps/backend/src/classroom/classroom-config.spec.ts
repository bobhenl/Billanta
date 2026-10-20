import { describe, expect, it } from "vitest";
import { studentSessionEnd } from "./classroom-config";

describe("studentSessionEnd", () => {
  const now = Date.parse("2026-10-19T08:00:00Z");

  it("caps the session at two weeks", () => {
    expect(studentSessionEnd(new Date("2027-09-30T00:00:00Z"), now)).toBe("2026-11-02T08:00:00.000Z");
  });

  it("ends with the company when that comes first", () => {
    expect(studentSessionEnd(new Date("2026-10-25T00:00:00Z"), now)).toBe("2026-10-25T00:00:00.000Z");
  });
});
