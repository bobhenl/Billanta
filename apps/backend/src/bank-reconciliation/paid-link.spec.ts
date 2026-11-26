import { describe, expect, it } from "vitest";
import { findPaidInvoiceLink, partyNameKey, type PaidLinkCandidate, type PaymentForLinking } from "./matching";

function paid(overrides: Partial<PaidLinkCandidate> & { id: string }): PaidLinkCandidate {
  return {
    currency: "USD",
    total: 40,
    issueDate: new Date("2026-10-07"),
    paidAt: new Date("2026-10-07T13:20:00Z"),
    contactEmail: "yusuf@example.com",
    contactName: "Yusuf Imran",
    alreadyLinked: false,
    ...overrides,
  };
}

function payment(overrides: Partial<PaymentForLinking> = {}): PaymentForLinking {
  return {
    amount: 40,
    currency: "USD",
    transactionDate: new Date("2026-10-07"),
    counterpartyAccount: "Yusuf@Example.com",
    counterpartyName: "Someone Else",
    ...overrides,
  };
}

describe("findPaidInvoiceLink", () => {
  it("links a PayPal payment to the paid invoice of the same payer, day and amount", () => {
    expect(findPaidInvoiceLink(payment(), [paid({ id: "inv-1" })])).toEqual({
      type: "linked",
      invoiceId: "inv-1",
      matchedBy: "paid_invoice",
    });
  });

  it("links on the counterparty name when there is no e-mail (a CZK bank payment)", () => {
    const candidates = [
      paid({ id: "inv-1", currency: "CZK", total: 2795, contactEmail: null, contactName: "Frost Studio s.r.o." }),
    ];
    const tx = payment({ currency: "CZK", amount: 2795, counterpartyAccount: "CZ6508000000192000145399", counterpartyName: "FROST STUDIO" });
    expect(findPaidInvoiceLink(tx, candidates)).toMatchObject({ type: "linked", invoiceId: "inv-1" });
  });

  it("needs the same currency", () => {
    expect(findPaidInvoiceLink(payment({ currency: "EUR" }), [paid({ id: "inv-1" })])).toEqual({ type: "unmatched", reason: "no_candidate" });
  });

  it("needs the payer: neither e-mail nor name fits", () => {
    const tx = payment({ counterpartyAccount: "other@example.com", counterpartyName: "Other Person" });
    expect(findPaidInvoiceLink(tx, [paid({ id: "inv-1" })])).toEqual({ type: "unmatched", reason: "no_candidate" });
  });

  it("links a platform payout by an exact amount with haléře on the same day, without the payer", () => {
    const inv = paid({ id: "inv-1", currency: "CZK", total: 21575.31, issueDate: new Date("2026-08-05"), paidAt: null, contactEmail: null, contactName: "Shop Ltd" });
    const tx = payment({ currency: "CZK", amount: 21575.31, transactionDate: new Date("2026-08-06"), counterpartyAccount: "1000000001/0800", counterpartyName: "Bank Payouts" });
    expect(findPaidInvoiceLink(tx, [inv])).toMatchObject({ type: "linked", invoiceId: "inv-1" });
    expect(findPaidInvoiceLink({ ...tx, transactionDate: new Date("2026-08-07") }, [inv])).toMatchObject({ type: "unmatched" });
    expect(findPaidInvoiceLink({ ...tx, amount: 21575 }, [{ ...inv, total: 21575 }])).toMatchObject({ type: "unmatched" });
    expect(findPaidInvoiceLink(tx, [inv, { ...inv, id: "inv-2" }])).toEqual({ type: "unmatched", reason: "ambiguous" });
  });

  it("needs the exact amount when the invoice has a total", () => {
    expect(findPaidInvoiceLink(payment({ amount: 40.5 }), [paid({ id: "inv-1" })])).toEqual({ type: "unmatched", reason: "no_candidate" });
  });

  it("accepts paid_at or issue date up to 7 days away, not 8", () => {
    const issuedEarlier = paid({ id: "inv-1", issueDate: new Date("2026-09-30"), paidAt: null });
    expect(findPaidInvoiceLink(payment(), [issuedEarlier])).toMatchObject({ type: "linked" });
    const paidLater = paid({ id: "inv-2", issueDate: null, paidAt: new Date("2026-10-14T22:00:00Z") });
    expect(findPaidInvoiceLink(payment(), [paidLater])).toMatchObject({ type: "linked" });
    const tooFar = paid({ id: "inv-3", issueDate: new Date("2026-09-29"), paidAt: new Date("2026-10-15") });
    expect(findPaidInvoiceLink(payment(), [tooFar])).toEqual({ type: "unmatched", reason: "no_candidate" });
  });

  it("uses whichever of paid_at and issue date is closer", () => {
    // Issued long before, paid on the payment day.
    const candidate = paid({ id: "inv-1", issueDate: new Date("2026-08-01"), paidAt: new Date("2026-10-08") });
    expect(findPaidInvoiceLink(payment(), [candidate])).toMatchObject({ type: "linked" });
  });

  it("needs a date at all", () => {
    expect(findPaidInvoiceLink(payment(), [paid({ id: "inv-1", issueDate: null, paidAt: null })])).toEqual({
      type: "unmatched",
      reason: "no_candidate",
    });
  });

  it("accepts a zero-total import only with the payer's e-mail and a day or less apart", () => {
    const zero = paid({ id: "inv-1", total: 0, issueDate: new Date("2026-10-06"), paidAt: null });
    expect(findPaidInvoiceLink(payment(), [zero])).toMatchObject({ type: "linked", invoiceId: "inv-1" });

    const twoDays = paid({ id: "inv-2", total: 0, issueDate: new Date("2026-10-05"), paidAt: null });
    expect(findPaidInvoiceLink(payment(), [twoDays])).toEqual({ type: "unmatched", reason: "no_candidate" });

    // Name fits, e-mail does not: not enough without an amount.
    const nameOnly = payment({ counterpartyAccount: "other@example.com", counterpartyName: "Yusuf Imran" });
    expect(findPaidInvoiceLink(nameOnly, [zero])).toEqual({ type: "unmatched", reason: "no_candidate" });
  });

  it("never links a credit note's negative total to an incoming payment", () => {
    expect(findPaidInvoiceLink(payment(), [paid({ id: "inv-1", total: -40 })])).toEqual({ type: "unmatched", reason: "no_candidate" });
  });

  it("skips an invoice another payment already links to", () => {
    const candidates = [paid({ id: "inv-1", alreadyLinked: true }), paid({ id: "inv-2", alreadyLinked: false, paidAt: new Date("2026-10-09") })];
    expect(findPaidInvoiceLink(payment(), candidates)).toMatchObject({ type: "linked", invoiceId: "inv-2" });
    expect(findPaidInvoiceLink(payment(), [paid({ id: "inv-1", alreadyLinked: true })])).toEqual({ type: "unmatched", reason: "no_candidate" });
  });

  it("leaves two fitting invoices unmatched", () => {
    const candidates = [paid({ id: "inv-1" }), paid({ id: "inv-2", paidAt: new Date("2026-10-09") })];
    expect(findPaidInvoiceLink(payment(), candidates)).toEqual({ type: "unmatched", reason: "ambiguous" });
  });

  it("ignores outgoing payments", () => {
    expect(findPaidInvoiceLink(payment({ amount: -40 }), [paid({ id: "inv-1", total: -40 })])).toEqual({
      type: "unmatched",
      reason: "no_candidate",
    });
  });
});

describe("partyNameKey", () => {
  it("drops accents, case, word order and the legal form", () => {
    expect(partyNameKey("Novák Jan s.r.o.")).toBe(partyNameKey("JAN NOVAK"));
    expect(partyNameKey("Frost Studio, a. s.")).toBe("frost studio");
    expect(partyNameKey(null)).toBe("");
  });
});
