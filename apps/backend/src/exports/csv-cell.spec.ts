import { describe, expect, it } from "vitest";
import { csvCell, csvText } from "./csv-cell";

describe("csvCell", () => {
  it("prefixes text that starts like a formula", () => {
    for (const v of ["=1+1", "+420", "-2+3", "@SUM(A1)", "\tx", "\rx"]) expect(csvCell(v).replace(/^"/, "")).toMatch(/^'/);
  });

  it("leaves ordinary text alone and quotes separators", () => {
    expect(csvText("Software")).toBe("Software");
    expect(csvText("A; B")).toBe('"A; B"');
    expect(csvText('=A1;"x"')).toBe(`"'=A1;""x"""`);
  });

  it("keeps numbers, negative ones included, as numbers", () => {
    expect(csvCell(-1234.5)).toBe("-1234,50");
    expect(csvCell(0)).toBe("0,00");
    expect(csvCell(null)).toBe("");
  });
});
