import { describe, expect, it } from "vitest";
import { platformBillingEntity, proformaAmounts, proformaIdentifiers, proformaSpayd } from "./bank-transfer";

const ENV = {
  PLATFORM_BILLING_NAME: "Billanta s.r.o.",
  PLATFORM_BILLING_ICO: "12345678",
  PLATFORM_BILLING_IBAN: "CZ65 0800 0000 1920 0014 5399",
};

describe("platformBillingEntity", () => {
  it("stays off until name, IČO and a valid IBAN are set", () => {
    expect(platformBillingEntity({})).toBeNull();
    expect(platformBillingEntity({ ...ENV, PLATFORM_BILLING_ICO: " " })).toBeNull();
    expect(platformBillingEntity({ ...ENV, PLATFORM_BILLING_IBAN: "not-an-iban" })).toBeNull();
  });

  it("normalises the IBAN and falls back on bad numbers", () => {
    const e = platformBillingEntity({ ...ENV, PLATFORM_BILLING_VAT_RATE: "99", PLATFORM_BILLING_DUE_DAYS: "x" });
    expect(e).toMatchObject({ iban: "CZ6508000000192000145399", vatRate: 0, dueDays: 14, dic: null });
    expect(platformBillingEntity({ ...ENV, PLATFORM_BILLING_VAT_RATE: "21" })?.vatRate).toBe(21);
  });
});

describe("proformaAmounts", () => {
  it("charges a year at the yearly transfer rate, VAT on top", () => {
    // Card 239 Kč a month on a year, +10 % = 262.90, rounded up to 263 Kč.
    expect(proformaAmounts("plus", 0, 12)).toEqual({ amountMinor: 263 * 12 * 100, totalMinor: 263 * 12 * 100 });
    // 3156 Kč + 21 % = 3818.76 Kč
    expect(proformaAmounts("plus", 21, 12)).toEqual({ amountMinor: 315600, totalMinor: 381876 });
  });

  it("charges a month at the monthly transfer price, VAT on top", () => {
    expect(proformaAmounts("plus", 0, 1)).toEqual({ amountMinor: 31800, totalMinor: 31800 });
    // 164 Kč + 21 % = 198.44 Kč
    expect(proformaAmounts("start", 21, 1)).toEqual({ amountMinor: 16400, totalMinor: 19844 });
    expect(proformaAmounts("business", 0, 1).amountMinor).toBe(63700);
  });
});

describe("proformaIdentifiers", () => {
  it("builds a 10-digit variable symbol and a matching number", () => {
    expect(proformaIdentifiers(2026, 42)).toEqual({ number: "PF2026000042", variableSymbol: "2026000042" });
  });
});

describe("proformaSpayd", () => {
  it("encodes account, amount, VS and due date", () => {
    const s = proformaSpayd(
      { iban: "CZ6508000000192000145399", bic: null, name: "Billanta" },
      { totalMinor: 347028, variableSymbol: "2026000042", number: "PF2026000042", dueDate: "2026-11-01" },
    );
    expect(s).toContain("ACC:CZ6508000000192000145399");
    expect(s).toContain("AM:3470.28");
    expect(s).toContain("X-VS:2026000042");
    expect(s).toContain("DT:20261101");
  });
});
