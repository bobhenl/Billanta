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
  /** Computed from `invoice_line_items` — `invoices` has no stored total
   *  column. See `computeInvoiceTotal` / `bank-reconciliation.service.ts`. */
  total: number;
}

export interface TransactionForMatching {
  variableSymbol: string | null;
  amount: number;
  currency: string;
  transactionDate: Date;
}

export type MatchOutcome =
  | { type: "matched"; invoiceId: string; matchedBy: "variable_symbol" | "amount_and_due_date" }
  | { type: "unmatched"; reason: "no_candidate" | "ambiguous" };

export function findInvoiceMatch(
  transaction: TransactionForMatching,
  candidates: MatchCandidateInvoice[],
): MatchOutcome {
  // 1. Exact variable symbol match — the primary signal in CZ/SK bank
  // transfers, since the payer's bank typically carries it through
  // unmodified. Deliberately does NOT also require amount/currency
  // agreement (see the module doc comment + README precision-tradeoffs
  // note): a variable symbol collision across two *issued* invoices for the
  // same tenant is caught below and left ambiguous, but a VS match against
  // an invoice with a different amount (e.g. a partial payment) is still
  // trusted, matching the brief's "either A or (fallback) B" — not "A and
  // a same amount check".
  if (transaction.variableSymbol) {
    const vsMatches = candidates.filter((c) => c.variableSymbol === transaction.variableSymbol);
    if (vsMatches.length === 1) {
      return { type: "matched", invoiceId: vsMatches[0].id, matchedBy: "variable_symbol" };
    }
    if (vsMatches.length > 1) {
      return { type: "unmatched", reason: "ambiguous" };
    }
  }

  // 2. Fallback: exact amount + currency match, due date within the window.
  const windowMs = AMOUNT_DATE_MATCH_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const amountMatches = candidates.filter((c) => {
    if (c.currency !== transaction.currency) return false;
    if (!c.dueDate) return false;
    if (!amountsEqual(c.total, transaction.amount)) return false;
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
