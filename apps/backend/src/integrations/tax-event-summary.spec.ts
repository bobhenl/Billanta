import { describe, expect, it } from "vitest";
import { taxEventSummary } from "./integrations.service";

describe("taxEventSummary", () => {
  const history = [
    { from: "2025-01", social: 4759, flat_tax: 8716 },
    { from: "2026-01", social: 5720, flat_tax: 9984 },
  ];

  it("adds the amount that applied for the month the payment covers", () => {
    // 20 January pays December's social advance, but January's paušální daň.
    expect(taxEventSummary("Sociální", "social", new Date(2026, 0, 20), history, "CZ")).toBe("Sociální · 4759.00 CZK");
    expect(taxEventSummary("Sociální", "social", new Date(2026, 1, 20), history, "CZ")).toBe("Sociální · 5720.00 CZK");
    expect(taxEventSummary("Paušál", "flat_tax", new Date(2026, 0, 20), history, "CZ")).toBe("Paušál · 9984.00 CZK");
  });

  it("no amount: label only; other kinds never get one", () => {
    expect(taxEventSummary("Zdravotní", "health", new Date(2026, 0, 8), history, "CZ")).toBe("Zdravotní");
    expect(taxEventSummary("DPH", "vat_monthly", new Date(2026, 0, 26), history, "CZ")).toBe("DPH");
    expect(taxEventSummary("Sociálne", "social", new Date(2026, 1, 20), history, "SK")).toBe("Sociálne · 5720.00 EUR");
  });
});
