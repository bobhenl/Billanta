import { describe, expect, it } from "vitest";
import { expenseVatParts } from "./expense-vat";

describe("expenseVatParts", () => {
  it("splits the VAT out of a normal gross amount", () => {
    const { base, vat } = expenseVatParts(1210, 21, false);
    expect(base).toBeCloseTo(1000, 6);
    expect(vat).toBeCloseTo(210, 6);
  });

  it("adds self-assessed VAT on top of a reverse-charge net amount", () => {
    expect(expenseVatParts(1000, 21, true)).toEqual({ base: 1000, vat: 210 });
    expect(expenseVatParts(1000, 12, true)).toEqual({ base: 1000, vat: 120 });
  });
});
