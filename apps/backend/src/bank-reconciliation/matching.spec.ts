import { describe, expect, it } from "vitest";
import { findInvoiceMatch, type MatchCandidateInvoice, type TransactionForMatching } from "./matching";

function invoice(overrides: Partial<MatchCandidateInvoice> & { id: string }): MatchCandidateInvoice {
  return {
    variableSymbol: null,
    currency: "CZK",
    dueDate: null,
    total: 0,
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
  it("matches on an exact variable symbol, even when the amount also happens to differ", () => {
    const candidates = [
      invoice({ id: "inv-1", variableSymbol: "1234567890", total: 999999 }),
      invoice({ id: "inv-2", variableSymbol: "0000000001", total: 100 }),
    ];

    const result = findInvoiceMatch(
      transaction({ variableSymbol: "1234567890", amount: 100 }),
      candidates,
    );

    expect(result).toEqual({ type: "matched", invoiceId: "inv-1", matchedBy: "variable_symbol" });
  });

  it("falls back to amount + currency + due-date-window match when there is no variable symbol", () => {
    const candidates = [
      invoice({
        id: "inv-1",
        currency: "CZK",
        dueDate: new Date("2026-08-20"),
        total: 1500,
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
        total: 2500,
      }),
    ];

    const result = findInvoiceMatch(
      transaction({ variableSymbol: "9999999999", amount: 2500, currency: "CZK" }),
      candidates,
    );

    expect(result).toEqual({ type: "matched", invoiceId: "inv-1", matchedBy: "amount_and_due_date" });
  });

  it("stays unmatched when the amount matches but the due date is outside the ±60-day window", () => {
    const candidates = [invoice({ id: "inv-1", dueDate: new Date("2026-01-01"), total: 1500 })];

    const result = findInvoiceMatch(
      transaction({ amount: 1500, transactionDate: new Date("2026-09-01") }),
      candidates,
    );

    expect(result).toEqual({ type: "unmatched", reason: "no_candidate" });
  });

  it("stays unmatched (never guesses) when two issued invoices share the same variable symbol", () => {
    const candidates = [
      invoice({ id: "inv-1", variableSymbol: "555", total: 100 }),
      invoice({ id: "inv-2", variableSymbol: "555", total: 200 }),
    ];

    const result = findInvoiceMatch(transaction({ variableSymbol: "555", amount: 100 }), candidates);

    expect(result).toEqual({ type: "unmatched", reason: "ambiguous" });
  });

  it("stays unmatched (never guesses) when two invoices tie on amount, currency, and due-date window", () => {
    const candidates = [
      invoice({ id: "inv-1", dueDate: new Date("2026-08-15"), total: 1000 }),
      invoice({ id: "inv-2", dueDate: new Date("2026-09-10"), total: 1000 }),
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
    const candidates = [invoice({ id: "inv-1", dueDate: new Date("2026-09-01"), currency: "EUR", total: 500 })];

    const result = findInvoiceMatch(
      transaction({ amount: 500, currency: "CZK", transactionDate: new Date("2026-09-01") }),
      candidates,
    );

    expect(result).toEqual({ type: "unmatched", reason: "no_candidate" });
  });

  it("does not match an invoice with no due date via the amount fallback", () => {
    const candidates = [invoice({ id: "inv-1", dueDate: null, total: 500 })];

    const result = findInvoiceMatch(transaction({ amount: 500 }), candidates);

    expect(result).toEqual({ type: "unmatched", reason: "no_candidate" });
  });

  it("tolerates sub-cent floating point noise when comparing amounts", () => {
    const candidates = [invoice({ id: "inv-1", dueDate: new Date("2026-09-01"), total: 100.1 + 0.2 })];

    const result = findInvoiceMatch(
      transaction({ amount: 100.3, transactionDate: new Date("2026-09-01") }),
      candidates,
    );

    expect(result).toEqual({ type: "matched", invoiceId: "inv-1", matchedBy: "amount_and_due_date" });
  });
});
