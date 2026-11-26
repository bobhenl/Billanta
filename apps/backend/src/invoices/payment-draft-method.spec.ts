import { describe, expect, it } from "vitest";
import { paymentDraftMethod } from "./invoices.service";

describe("paymentDraftMethod", () => {
  it("names the method by where the payment came from", () => {
    expect(paymentDraftMethod("Banka")).toEqual({ paymentMethod: "bank_transfer", paymentMethodLabel: null });
    expect(paymentDraftMethod("Stripe")).toEqual({ paymentMethod: "card", paymentMethodLabel: null });
    expect(paymentDraftMethod("PayPal")).toEqual({ paymentMethod: "other", paymentMethodLabel: "PayPal" });
  });
});
