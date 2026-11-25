import { describe, expect, it } from "vitest";
import { appendNoteLine, paypalPaymentNote } from "./payment-note";

describe("paypalPaymentNote", () => {
  it("shows the fee, what arrived after PayPal's conversion and its rate", () => {
    expect(paypalPaymentNote({ amount: 25, currency: "usd", fee: 1.2, netAmount: 545.12, netCurrency: "CZK" })).toBe(
      "PayPal: zaplaceno 25,00 USD, poplatek 1,20 USD, připsáno 545,12 Kč (kurz 22,9042 Kč/USD)",
    );
  });

  it("subtracts the fee when the payment stayed in its currency", () => {
    expect(paypalPaymentNote({ amount: 1000, currency: "CZK", fee: 44.9 })).toBe(
      "PayPal: zaplaceno 1 000,00 Kč, poplatek 44,90 Kč, připsáno 955,10 Kč",
    );
  });

  it("says only the amount without a fee or conversion", () => {
    expect(paypalPaymentNote({ amount: 10, currency: "EUR", fee: null, netAmount: null })).toBe("PayPal: zaplaceno 10,00 EUR");
  });

  it("names Stripe for a Stripe payment", () => {
    expect(paypalPaymentNote({ amount: 100, currency: "EUR", fee: 3.5, netAmount: 2412.5, netCurrency: "CZK" }, "Stripe")).toBe(
      "Stripe: zaplaceno 100,00 EUR, poplatek 3,50 EUR, připsáno 2 412,50 Kč (kurz 25 Kč/EUR)",
    );
  });
});

describe("appendNoteLine", () => {
  it("adds the line under the existing note once", () => {
    expect(appendNoteLine(null, "A")).toBe("A");
    expect(appendNoteLine("Poznámka", "A")).toBe("Poznámka\nA");
    expect(appendNoteLine("Poznámka\nA", "A")).toBe("Poznámka\nA");
  });
});
