import { describe, expect, it } from "vitest";
import { convertHeldPayments } from "./paypal-conversions";

const at = (s: string) => new Date(s);
const payment = (id: string, when: string, amount: string, fee: string | null = null, currency = "USD") => ({ id, at: at(when), amount, currency, fee });

describe("convertHeldPayments", () => {
  it("gives the payments a withdrawal converted its real rate, after the fee", () => {
    const [row] = convertHeldPayments(
      [{ at: at("2026-11-02T08:00:00Z"), amount: "905.13", currency: "CZK", from: { amount: "42.59", currency: "USD" } }],
      [payment("p1", "2026-10-20T10:00:00Z", "45.00", "-2.41")],
      "CZK",
    );
    expect(row).toMatchObject({ id: "p1", netAmount: "905.13", netCurrency: "CZK" });
    expect(row!.rate).toBeCloseTo(21.2522, 4);
  });

  it("spends the balance oldest first and stops when the conversion is used up", () => {
    const rows = convertHeldPayments(
      [{ at: at("2026-11-02T08:00:00Z"), amount: "420.00", currency: "CZK", from: { amount: "20.00", currency: "USD" } }],
      [payment("newer", "2026-10-25T10:00:00Z", "10.00"), payment("older", "2026-10-01T10:00:00Z", "20.00"), payment("third", "2026-10-26T10:00:00Z", "5.00")],
      "CZK",
    );
    expect(rows.map((r) => [r.id, r.netAmount])).toEqual([["older", "420.00"]]);
  });

  it("skips payments received after the conversion and other currencies", () => {
    const rows = convertHeldPayments(
      [{ at: at("2026-11-02T08:00:00Z"), amount: "420.00", currency: "CZK", from: { amount: "20.00", currency: "USD" } }],
      [payment("eur", "2026-10-01T10:00:00Z", "10.00", null, "EUR"), payment("after", "2026-11-03T10:00:00Z", "10.00"), payment("usd", "2026-10-02T10:00:00Z", "10.00")],
      "CZK",
    );
    expect(rows.map((r) => r.id)).toEqual(["usd"]);
  });

  it("ignores conversions that do not end in the home currency", () => {
    expect(
      convertHeldPayments(
        [{ at: at("2026-11-02T08:00:00Z"), amount: "9.00", currency: "EUR", from: { amount: "10.00", currency: "USD" } }],
        [payment("p", "2026-10-01T10:00:00Z", "10.00")],
        "CZK",
      ),
    ).toEqual([]);
  });
});
