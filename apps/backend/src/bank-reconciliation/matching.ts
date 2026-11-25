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

/**
 * Second tier, run only when `findInvoiceMatch` found no candidate at all:
 * link the payment to an invoice that is already `paid` (typically history
 * imported from another invoicing system). Linking only records which
 * invoice the money belongs to; the caller must never mark or change the
 * invoice. PayPal's "VS" is PayPal's own number, so this tier ignores it and
 * relies on who paid, when and how much.
 */
export const PAID_LINK_WINDOW_DAYS = 7;
/** An imported invoice with a zero total says nothing about the amount, so the date has to be close instead. */
export const PAID_LINK_ZERO_TOTAL_WINDOW_DAYS = 1;

export interface PaidLinkCandidate {
  id: string;
  currency: string;
  /** Full invoice total from its line items; 0 for some imported invoices. */
  total: number;
  issueDate: Date | null;
  paidAt: Date | null;
  contactEmail: string | null;
  contactName: string | null;
  /** Some bank transaction already points at this invoice. */
  alreadyLinked: boolean;
}

export interface PaymentForLinking {
  amount: number;
  currency: string;
  transactionDate: Date;
  /** IBAN for bank rows, the payer's e-mail for PayPal. */
  counterpartyAccount: string | null;
  counterpartyName: string | null;
}

export type PaidLinkOutcome =
  | { type: "linked"; invoiceId: string; matchedBy: "paid_invoice" }
  | { type: "unmatched"; reason: "no_candidate" | "ambiguous" };

const LEGAL_FORMS = new Set(["sro", "spol", "as", "vos", "ks", "zs", "ltd", "llc", "inc", "gmbh", "plc", "corp", "co"]);

/** "Novák Jan s.r.o." and "jan NOVAK" give the same key: accents, case, order and the legal form don't count. */
export function partyNameKey(name: string | null | undefined): string {
  if (!name) return "";
  const tokens = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\b(s\.\s?r\.\s?o|a\.\s?s|v\.\s?o\.\s?s|k\.\s?s|z\.\s?s)\.?/g, " ")
    .split(/[^a-z0-9]+/)
    .filter((token) => token && !LEGAL_FORMS.has(token));
  return tokens.sort().join(" ");
}

function emailKey(value: string | null | undefined): string {
  const v = value?.trim().toLowerCase() ?? "";
  return v.includes("@") ? v : "";
}

/** Whole UTC days between two moments, so a paid_at with a time of day still counts as that day. */
function dayDistance(a: Date, b: Date): number {
  const day = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return Math.abs(day(a) - day(b)) / (24 * 60 * 60 * 1000);
}

export function findPaidInvoiceLink(payment: PaymentForLinking, candidates: PaidLinkCandidate[]): PaidLinkOutcome {
  if (!(payment.amount > 0)) return { type: "unmatched", reason: "no_candidate" };
  const email = emailKey(payment.counterpartyAccount);
  const name = partyNameKey(payment.counterpartyName);

  const hits = candidates.filter((c) => {
    if (c.alreadyLinked) return false;
    if (c.currency !== payment.currency) return false;
    const emailMatch = email !== "" && emailKey(c.contactEmail) === email;
    const nameMatch = name !== "" && partyNameKey(c.contactName) === name;
    if (!emailMatch && !nameMatch) return false;
    const distances = [c.paidAt, c.issueDate].filter((d): d is Date => d !== null).map((d) => dayDistance(d, payment.transactionDate));
    if (distances.length === 0) return false;
    const closest = Math.min(...distances);
    if (closest > PAID_LINK_WINDOW_DAYS) return false;
    // Any non-zero total (a credit note's negative one too) has to be paid exactly.
    if (!amountsEqual(c.total, 0)) return amountsEqual(c.total, payment.amount);
    // Zero total (import quirk): only the payer's own e-mail plus a near-same day is enough.
    return emailMatch && closest <= PAID_LINK_ZERO_TOTAL_WINDOW_DAYS;
  });

  if (hits.length === 1) return { type: "linked", invoiceId: hits[0].id, matchedBy: "paid_invoice" };
  if (hits.length > 1) return { type: "unmatched", reason: "ambiguous" };
  return { type: "unmatched", reason: "no_candidate" };
}
