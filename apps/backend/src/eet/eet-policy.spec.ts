import { describe, expect, it } from "vitest";
import type { SendEetResult } from "@faktur/cz-compliance/eet";
import { attemptOutcome, eetAmountCzk, eetSaleTime, isContactPayment, planEetPayment, resendDue, reversalAmount, type EetPaymentInput } from "./eet-policy";

const now = new Date("2027-03-05T11:25:01Z"); // 12:25:01 in Prague

const base: EetPaymentInput = {
  environment: "production",
  method: "cash",
  cardInPerson: false,
  documentType: "invoice",
  currency: "CZK",
  exchangeRate: null,
  paidDelta: 250,
  now,
};

describe("isContactPayment (§ 5, 6)", () => {
  it("records cash, and cards only when taken in person", () => {
    expect(isContactPayment("cash", false)).toBe(true);
    expect(isContactPayment("card", false)).toBe(false);
    expect(isContactPayment("card", true)).toBe(true);
  });

  it("never records a bank transfer, dobírka or other", () => {
    for (const m of ["bank_transfer", "cash_on_delivery", "other"] as const) {
      expect(isContactPayment(m, true)).toBe(false);
    }
  });
});

describe("planEetPayment", () => {
  it("records a cash payment in CZK at the moment of the click", () => {
    expect(planEetPayment(base)).toEqual({
      record: true,
      kind: "sale",
      celkTrzba: "250.00",
      datTrzby: "2027-03-05T12:25:01+01:00",
      saleAt: now,
    });
  });

  it("skips a bank transfer", () => {
    expect(planEetPayment({ ...base, method: "bank_transfer" })).toEqual({ record: false, reason: "not_contact_payment" });
  });

  it("records each partial payment on its own (methodology item 12)", () => {
    const plan = planEetPayment({ ...base, paidDelta: 333.33 });
    expect(plan.record && plan.celkTrzba).toBe("333.33");
  });

  it("makes a credit note paid out in cash a negative refund (§ 8)", () => {
    expect(planEetPayment({ ...base, documentType: "credit_note", paidDelta: 100 })).toMatchObject({ record: true, kind: "refund", celkTrzba: "-100.00" });
    expect(planEetPayment({ ...base, documentType: "credit_note", paidDelta: -100 })).toMatchObject({ kind: "refund", celkTrzba: "-100.00" });
  });

  it("converts a foreign currency with the invoice's rate, else the CZK typed in", () => {
    expect(planEetPayment({ ...base, currency: "EUR", exchangeRate: "25.125", paidDelta: 10 })).toMatchObject({ celkTrzba: "251.25" });
    expect(planEetPayment({ ...base, currency: "EUR", exchangeRate: null, paidDelta: 10, receivedCzk: 249.5 })).toMatchObject({ celkTrzba: "249.50" });
    expect(planEetPayment({ ...base, currency: "EUR", exchangeRate: null, paidDelta: 10 })).toEqual({ record: false, reason: "no_czk_amount" });
  });

  it("records nothing in production before 1. 1. 2027 (§ 36), but the playground takes it", () => {
    const dec = new Date("2026-12-31T22:00:00Z");
    expect(planEetPayment({ ...base, now: dec })).toEqual({ record: false, reason: "before_start" });
    expect(planEetPayment({ ...base, environment: "playground", now: dec })).toMatchObject({ record: true });
  });

  it("skips an amount that rounds to zero", () => {
    expect(planEetPayment({ ...base, paidDelta: 0.004 })).toEqual({ record: false, reason: "zero_amount" });
  });
});

describe("eetSaleTime (§ 16)", () => {
  it("keeps an earlier day the user entered", () => {
    const earlier = new Date("2027-03-03T00:00:00Z");
    expect(eetSaleTime(earlier, now)).toBe(earlier);
  });

  it("uses the click for today's date and for a future one", () => {
    expect(eetSaleTime(new Date("2027-03-05T00:00:00Z"), now)).toBe(now);
    expect(eetSaleTime(new Date("2027-03-09T00:00:00Z"), now)).toBe(now);
    expect(eetSaleTime(undefined, now)).toBe(now);
  });

  it("compares days in Prague time, not UTC", () => {
    // 23:30 UTC on the 4th is already the 5th in Prague.
    expect(eetSaleTime(new Date("2027-03-04T23:30:00Z"), now)).toBe(now);
  });
});

describe("eetAmountCzk", () => {
  it("ignores a zero or broken rate", () => {
    expect(eetAmountCzk({ currency: "EUR", exchangeRate: "0", paidDelta: 1 })).toBeNull();
    expect(eetAmountCzk({ currency: "EUR", exchangeRate: "abc", paidDelta: 1, receivedCzk: 25 })).toBe(25);
  });
});

describe("reversalAmount", () => {
  it("negates the net of the records that were not rejected", () => {
    expect(
      reversalAmount([
        { celkTrzba: "100.00", status: "confirmed" },
        { celkTrzba: "50.50", status: "pending" },
        { celkTrzba: "999.00", status: "rejected" },
      ]),
    ).toBe("-150.50");
  });

  it("is null when nothing is left to reverse", () => {
    expect(reversalAmount([{ celkTrzba: "100.00", status: "confirmed" }, { celkTrzba: "-100.00", status: "confirmed" }])).toBeNull();
    expect(reversalAmount([])).toBeNull();
  });

  it("reverses a net refund with a positive record", () => {
    expect(reversalAmount([{ celkTrzba: "-0.50", status: "confirmed" }])).toBe("0.50");
  });
});

describe("resendDue", () => {
  const at = new Date("2027-03-05T12:00:00Z");
  it("retries every sweep at first, then hourly", () => {
    expect(resendDue(0, null, at)).toBe(true);
    expect(resendDue(2, new Date(at.getTime() - 3 * 60_000), at)).toBe(false);
    expect(resendDue(2, new Date(at.getTime() - 5 * 60_000), at)).toBe(true);
    expect(resendDue(6, new Date(at.getTime() - 30 * 60_000), at)).toBe(false);
    expect(resendDue(6, new Date(at.getTime() - 56 * 60_000), at)).toBe(true);
  });
});

describe("attemptOutcome", () => {
  const saleAt = new Date("2027-03-05T11:00:00Z");
  const sent = (response: Extract<SendEetResult, { sent: true }>["response"]): SendEetResult => ({ sent: true, httpStatus: 200, response, transactionId: "tx-1" });

  it("stores the POK of a confirmation", () => {
    const pok = "0f7e5c39-8a6b-4f2d-9c11-2e3a4b5c6d7e-ff";
    expect(attemptOutcome(sent({ kind: "confirmed", pok, uuidZpravy: null, datPrij: null, test: true, warnings: [] }), saleAt, saleAt)).toMatchObject({
      status: "confirmed",
      pok,
      test: true,
      transactionId: "tx-1",
    });
  });

  it("keeps a record pending after a timeout or error -1, and rejects any other error", () => {
    expect(attemptOutcome({ sent: false, reason: "timeout", transactionId: null }, saleAt, saleAt)).toMatchObject({ status: "pending", lastError: "timeout" });
    const err = (code: number) => sent({ kind: "error", code, text: "x", uuidZpravy: null, datOdmit: null, test: false, retryable: code === -1, warnings: [] });
    expect(attemptOutcome(err(-1), saleAt, saleAt)).toMatchObject({ status: "pending", lastError: "eet_error_-1" });
    expect(attemptOutcome(err(4), saleAt, saleAt)).toMatchObject({ status: "rejected", lastError: "eet_error_4" });
  });

  it("retries a SOAP fault or an unreadable answer", () => {
    expect(attemptOutcome(sent({ kind: "fault", faultCode: "s:Server", faultString: "x" }), saleAt, saleAt)).toMatchObject({ status: "pending", lastError: "soap_fault" });
    expect(attemptOutcome({ sent: true, httpStatus: 502, response: { kind: "unparseable" }, transactionId: null }, saleAt, saleAt)).toMatchObject({
      status: "pending",
      lastError: "unparseable_http_502",
    });
  });

  it("flags a record still unanswered after 48 hours as overdue (§ 20)", () => {
    const later = new Date(saleAt.getTime() + 48 * 3600_000 + 1000);
    expect(attemptOutcome({ sent: false, reason: "network", transactionId: null }, saleAt, later)).toMatchObject({ status: "overdue" });
    const justIn = new Date(saleAt.getTime() + 47 * 3600_000);
    expect(attemptOutcome({ sent: false, reason: "network", transactionId: null }, saleAt, justIn)).toMatchObject({ status: "pending" });
  });
});
