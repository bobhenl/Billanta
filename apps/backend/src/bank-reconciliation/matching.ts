import { normalizeVariableSymbol } from "@faktur/cz-compliance";

/**
 * Auto-match logic for bank statement reconciliation. Deliberately a pure,
 * DB-free function — `bank-reconciliation.service.ts` does all the fetching
 * (issued invoices + their computed totals) and hands plain data in here, so
 * this file can be unit-tested (`matching.spec.ts`) without mocking Drizzle
 * at all.
 *
 * Design principle (see the task brief this module was built against):
 * correctness over completeness. A false "paid" mark on the wrong invoice is
 * a real problem, so any tie between two or more equally-good candidates
 * returns "ambiguous" rather than guessing — the transaction stays
 * `unmatched` and a human resolves it via the manual `.../match` endpoint.
 *
 * The same goes for a payment whose VS points at one invoice but whose
 * amount or currency does not settle it: a partial payment or an
 * overpayment is left for review instead of marking the invoice paid.
 */

/** ±60 days between the transaction date and the invoice's due date for the
 * amount/currency fallback match. Chosen as "reasonable" per the brief —
 * wide enough to catch early/late payments around a due date, narrow enough
 * that two unrelated invoices with the same round amount (e.g. two
 * 5000 CZK invoices) are unlikely to both fall in the window for the same
 * transaction. */
export const AMOUNT_DATE_MATCH_WINDOW_DAYS = 60;

export interface MatchCandidateInvoice {
  id: string;
  variableSymbol: string | null;
  currency: string;
  dueDate: Date | null;
  /** What is still to be paid: the total computed from `invoice_line_items`
   *  (`invoices` has no stored total column) minus `amount_paid` from
   *  earlier partial payments. See `bank-reconciliation.service.ts`. */
  amountDue: number;
}

export interface TransactionForMatching {
  variableSymbol: string | null;
  amount: number;
  currency: string;
  transactionDate: Date;
}

export type MatchOutcome =
  | { type: "matched"; invoiceId: string; matchedBy: "variable_symbol" | "amount_and_due_date" }
  | { type: "unmatched"; reason: "no_candidate" | "ambiguous" }
  /** The VS names one invoice, but the payment does not settle it exactly. */
  | { type: "unmatched"; reason: "amount_mismatch"; invoiceId: string };

export function findInvoiceMatch(
  transaction: TransactionForMatching,
  candidates: MatchCandidateInvoice[],
): MatchOutcome {
  // 1. Variable symbol: the primary signal in CZ/SK transfers, since the
  // payer's bank carries it through unmodified. Leading zeros don't count
  // (GPC pads the VS to 10 digits). Two issued invoices with one VS are
  // ambiguous; one invoice is matched only when the payment settles exactly
  // what is still due, in the invoice's currency.
  const variableSymbol = normalizeVariableSymbol(transaction.variableSymbol);
  if (variableSymbol) {
    const vsMatches = candidates.filter((c) => normalizeVariableSymbol(c.variableSymbol) === variableSymbol);
    if (vsMatches.length > 1) {
      return { type: "unmatched", reason: "ambiguous" };
    }
    const [invoice] = vsMatches;
    if (invoice) {
      if (invoice.currency === transaction.currency && amountsEqual(invoice.amountDue, transaction.amount)) {
        return { type: "matched", invoiceId: invoice.id, matchedBy: "variable_symbol" };
      }
      return { type: "unmatched", reason: "amount_mismatch", invoiceId: invoice.id };
    }
  }

  // 2. Fallback: exact amount + currency match, due date within the window.
  const windowMs = AMOUNT_DATE_MATCH_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const amountMatches = candidates.filter((c) => {
    if (c.currency !== transaction.currency) return false;
    if (!c.dueDate) return false;
    if (!amountsEqual(c.amountDue, transaction.amount)) return false;
    return Math.abs(c.dueDate.getTime() - transaction.transactionDate.getTime()) <= windowMs;
  });

  if (amountMatches.length === 1) {
    return { type: "matched", invoiceId: amountMatches[0].id, matchedBy: "amount_and_due_date" };
  }
  if (amountMatches.length > 1) {
    return { type: "unmatched", reason: "ambiguous" };
  }

  return { type: "unmatched", reason: "no_candidate" };
}

/** Compares to the cent to avoid floating-point equality issues (both sides
 * are ultimately derived from `numeric` Postgres columns via `Number(...)`). */
function amountsEqual(a: number, b: number): boolean {
  return Math.round(a * 100) === Math.round(b * 100);
}
