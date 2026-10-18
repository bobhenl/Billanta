import { describe, expect, it } from "vitest";
import { findInvoiceMatch, type MatchCandidateInvoice, type TransactionForMatching } from "./matching";

function invoice(overrides: Partial<MatchCandidateInvoice> & { id: string }): MatchCandidateInvoice {
  return {
    variableSymbol: null,
    currency: "CZK",
    dueDate: null,
    amountDue: 0,
    ...overrides,
  };
}

function transaction(overrides: Partial<TransactionForMatching> = {}): TransactionForMatching {
  return {
    variableSymbol: null,
    amount: 0,
    currency: "CZK",
    transactionDate: new Date("2026-09-01"),
    ...overrides,
  };
}

describe("findInvoiceMatch", () => {
  it("matches on variable symbol + the amount still due + currency", () => {
    const candidates = [
      invoice({ id: "inv-1", variableSymbol: "1234567890", amountDue: 1500 }),
      invoice({ id: "inv-2", variableSymbol: "0000000001", amountDue: 1500 }),
    ];

    const result = findInvoiceMatch(
      transaction({ variableSymbol: "1234567890", amount: 1500 }),
      candidates,
    );

    expect(result).toEqual({ type: "matched", invoiceId: "inv-1", matchedBy: "variable_symbol" });
  });

  it("ignores leading zeros in the variable symbol on either side", () => {
    const candidates = [invoice({ id: "inv-1", variableSymbol: "2026001", amountDue: 100 })];
    expect(findInvoiceMatch(transaction({ variableSymbol: "0002026001", amount: 100 }), candidates)).toMatchObject({
      type: "matched",
      invoiceId: "inv-1",
    });
    const padded = [invoice({ id: "inv-2", variableSymbol: "0002026002", amountDue: 100 })];
    expect(findInvoiceMatch(transaction({ variableSymbol: "2026002", amount: 100 }), padded)).toMatchObject({
      type: "matched",
      invoiceId: "inv-2",
    });
  });

  it("leaves a partial payment and an overpayment for review, naming the invoice", () => {
    const candidates = [
      invoice({ id: "inv-1", variableSymbol: "1234567890", amountDue: 1500, dueDate: new Date("2026-09-01") }),
      // Would win the amount fallback if a VS mismatch fell through to it.
      invoice({ id: "inv-2", amountDue: 500, dueDate: new Date("2026-09-01") }),
    ];
    for (const amount of [500, 1500.01]) {
      expect(findInvoiceMatch(transaction({ variableSymbol: "1234567890", amount }), candidates)).toEqual({
        type: "unmatched",
        reason: "amount_mismatch",
        invoiceId: "inv-1",
      });
    }
  });

  it("leaves a payment in another currency for review even when the number fits", () => {
    const candidates = [invoice({ id: "inv-1", variableSymbol: "77", currency: "EUR", amountDue: 100 })];
    expect(findInvoiceMatch(transaction({ variableSymbol: "77", amount: 100, currency: "CZK" }), candidates)).toEqual({
      type: "unmatched",
      reason: "amount_mismatch",
      invoiceId: "inv-1",
    });
  });

  it("matches the rest of a partly paid invoice", () => {
    const candidates = [invoice({ id: "inv-1", variableSymbol: "5", amountDue: 700 })];
    expect(findInvoiceMatch(transaction({ variableSymbol: "5", amount: 700 }), candidates)).toMatchObject({ type: "matched" });
  });

  it("falls back to amount + currency + due-date-window match when there is no variable symbol", () => {
    const candidates = [
      invoice({
        id: "inv-1",
        currency: "CZK",
        dueDate: new Date("2026-08-20"),
        amountDue: 1500,
      }),
    ];

    const result = findInvoiceMatch(
      transaction({ amount: 1500, currency: "CZK", transactionDate: new Date("2026-09-01") }),
      candidates,
    );

    expect(result).toEqual({ type: "matched", invoiceId: "inv-1", matchedBy: "amount_and_due_date" });
  });

  it("falls back to amount+date match when the variable symbol on the transaction doesn't match anything", () => {
    const candidates = [
      invoice({
        id: "inv-1",
        variableSymbol: null,
        currency: "CZK",
        dueDate: new Date("2026-08-20"),
        amountDue: 2500,
      }),
    ];

    const result = findInvoiceMatch(
      transaction({ variableSymbol: "9999999999", amount: 2500, currency: "CZK" }),
      candidates,
    );

    expect(result).toEqual({ type: "matched", invoiceId: "inv-1", matchedBy: "amount_and_due_date" });
  });

  it("stays unmatched when the amount matches but the due date is outside the ±60-day window", () => {
    const candidates = [invoice({ id: "inv-1", dueDate: new Date("2026-01-01"), amountDue: 1500 })];

    const result = findInvoiceMatch(
      transaction({ amount: 1500, transactionDate: new Date("2026-09-01") }),
      candidates,
    );

    expect(result).toEqual({ type: "unmatched", reason: "no_candidate" });
  });

  it("stays unmatched (never guesses) when two issued invoices share the same variable symbol", () => {
    const candidates = [
      invoice({ id: "inv-1", variableSymbol: "555", amountDue: 100 }),
      invoice({ id: "inv-2", variableSymbol: "555", amountDue: 200 }),
    ];

    const result = findInvoiceMatch(transaction({ variableSymbol: "555", amount: 100 }), candidates);

    expect(result).toEqual({ type: "unmatched", reason: "ambiguous" });
  });

  it("stays unmatched (never guesses) when two invoices tie on amount, currency, and due-date window", () => {
    const candidates = [
      invoice({ id: "inv-1", dueDate: new Date("2026-08-15"), amountDue: 1000 }),
      invoice({ id: "inv-2", dueDate: new Date("2026-09-10"), amountDue: 1000 }),
    ];

    const result = findInvoiceMatch(
      transaction({ amount: 1000, transactionDate: new Date("2026-09-01") }),
      candidates,
    );

    expect(result).toEqual({ type: "unmatched", reason: "ambiguous" });
  });

  it("stays unmatched when there are no candidates at all", () => {
    const result = findInvoiceMatch(transaction({ variableSymbol: "999", amount: 100 }), []);

    expect(result).toEqual({ type: "unmatched", reason: "no_candidate" });
  });

  it("does not match across currencies, even with the same amount and due date", () => {
    const candidates = [invoice({ id: "inv-1", dueDate: new Date("2026-09-01"), currency: "EUR", amountDue: 500 })];

    const result = findInvoiceMatch(
      transaction({ amount: 500, currency: "CZK", transactionDate: new Date("2026-09-01") }),
      candidates,
    );

    expect(result).toEqual({ type: "unmatched", reason: "no_candidate" });
  });

  it("does not match an invoice with no due date via the amount fallback", () => {
    const candidates = [invoice({ id: "inv-1", dueDate: null, amountDue: 500 })];

    const result = findInvoiceMatch(transaction({ amount: 500 }), candidates);

    expect(result).toEqual({ type: "unmatched", reason: "no_candidate" });
  });

  it("tolerates sub-cent floating point noise when comparing amounts", () => {
    const candidates = [invoice({ id: "inv-1", dueDate: new Date("2026-09-01"), amountDue: 100.1 + 0.2 })];

    const result = findInvoiceMatch(
      transaction({ amount: 100.3, transactionDate: new Date("2026-09-01") }),
      candidates,
    );

    expect(result).toEqual({ type: "matched", invoiceId: "inv-1", matchedBy: "amount_and_due_date" });
  });
});
