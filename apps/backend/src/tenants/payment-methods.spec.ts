import { describe, expect, it } from "vitest";
import { paymentMethodsOf, paymentMethodsSchema } from "./payment-methods";

describe("paymentMethodsSchema", () => {
  it("defaults the base and blanks empty instructions", () => {
    expect(paymentMethodsSchema.parse([{ id: "paypal", label: " PayPal ", instructions: "" }])).toEqual([
      { id: "paypal", label: "PayPal", base: "other", instructions: null },
    ]);
  });

  it("rejects duplicate ids and empty labels", () => {
    expect(paymentMethodsSchema.safeParse([{ id: "a", label: "A" }, { id: "a", label: "B" }]).success).toBe(false);
    expect(paymentMethodsSchema.safeParse([{ id: "a", label: "  " }]).success).toBe(false);
  });
});

describe("paymentMethodsOf", () => {
  it("drops junk and repairs an unknown base", () => {
    expect(paymentMethodsOf([null, { id: "x" }, { id: "z", label: "Zápočet", base: "barter" }])).toEqual([
      { id: "z", label: "Zápočet", base: "other", instructions: null },
    ]);
    expect(paymentMethodsOf("nope")).toEqual([]);
  });
});
