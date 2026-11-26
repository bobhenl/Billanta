import { describe, expect, it } from "vitest";
import { isPaypalCredit, pairTransfers } from "./transfer-pairing";

const day = (d: string) => new Date(`${d}T00:00:00Z`);
const withdrawal = (id: string, date: string, amount = "-1817.20", currency = "CZK") => ({ id, transactionDate: day(date), amount, currency });
const credit = (id: string, date: string, amount = "1817.20", extra: Partial<{ currency: string; counterpartyName: string | null }> = {}) => ({
  id,
  transactionDate: day(date),
  amount,
  currency: extra.currency ?? "CZK",
  counterpartyName: extra.counterpartyName === undefined ? "PAYPAL PTE LTD" : extra.counterpartyName,
  counterpartyAccount: "81880459/2700",
});

describe("isPaypalCredit", () => {
  it("knows PayPal by the payer's name", () => {
    expect(isPaypalCredit(credit("c", "2026-11-03"))).toBe(true);
    expect(isPaypalCredit(credit("c", "2026-11-03", "10.00", { counterpartyName: "PayPal Europe S.a r.l." }))).toBe(true);
    expect(isPaypalCredit(credit("c", "2026-11-03", "10.00", { counterpartyName: "Jana Nováková" }))).toBe(false);
    expect(isPaypalCredit(credit("c", "2026-11-03", "-10.00"))).toBe(false);
  });
});

describe("pairTransfers", () => {
  it("pairs a withdrawal with the PayPal credit of the same amount a few days later", () => {
    expect(pairTransfers([withdrawal("w", "2026-11-02")], [credit("other", "2026-11-03", "1817.21"), credit("c", "2026-11-04")])).toEqual([
      { withdrawalId: "w", creditId: "c" },
    ]);
  });

  it("needs the same currency and a credit from PayPal", () => {
    expect(pairTransfers([withdrawal("w", "2026-11-02")], [credit("c", "2026-11-03", "1817.20", { currency: "EUR" })])).toEqual([]);
    expect(pairTransfers([withdrawal("w", "2026-11-02")], [credit("c", "2026-11-03", "1817.20", { counterpartyName: "Jana" })])).toEqual([]);
  });

  it("allows a day early and a week late, no more", () => {
    expect(pairTransfers([withdrawal("w", "2026-11-02")], [credit("c", "2026-11-01")])).toHaveLength(1);
    expect(pairTransfers([withdrawal("w", "2026-11-02")], [credit("c", "2026-11-09")])).toHaveLength(1);
    expect(pairTransfers([withdrawal("w", "2026-11-02")], [credit("c", "2026-10-31")])).toEqual([]);
    expect(pairTransfers([withdrawal("w", "2026-11-02")], [credit("c", "2026-11-10")])).toEqual([]);
  });

  it("takes the nearest of two matching credits", () => {
    expect(pairTransfers([withdrawal("w", "2026-11-02")], [credit("far", "2026-11-07"), credit("near", "2026-11-03")])).toEqual([
      { withdrawalId: "w", creditId: "near" },
    ]);
  });

  it("gives each of two equal withdrawals its own nearest credit", () => {
    expect(
      pairTransfers(
        [withdrawal("late", "2026-11-09"), withdrawal("early", "2026-11-02")],
        [credit("c2", "2026-11-10"), credit("c1", "2026-11-03")],
      ),
    ).toEqual([
      { withdrawalId: "early", creditId: "c1" },
      { withdrawalId: "late", creditId: "c2" },
    ]);
  });
});
