import type { ParsedCsvRow } from "./csv-parser";
import { addAmounts, CURRENCY_PATTERN, negateAmount, nullIfEmpty, parseAmount, parseDate } from "./csv-values";
import { extractVariableSymbol } from "./enable-banking-client";

/**
 * CSV exports of Wise, Revolut and Stripe, for users who don't connect them
 * through an API. They are recognised by their header row and read by name,
 * like the bank exports in `csv-parser.ts`, but each needs its own rules for
 * the sign, the fee, the date's time zone and which rows are real money
 * movements.
 *
 * Shared decisions:
 * - The amount is the gross: what the payer sent, or the whole debit for an
 *   outgoing row. The fee goes into `fee` (positive), as in the PayPal sync,
 *   and only when it is in the row's currency.
 * - Outgoing rows are kept, as for every other CSV upload. Conversions
 *   between the user's own balances (Wise, Revolut exchanges) are dropped,
 *   like the PayPal sync drops them: they are not payments, and a converted
 *   1 000 EUR could otherwise match a 1 000 EUR invoice by amount.
 * - Rows that never moved money (cancelled, declined, reverted, failed,
 *   still pending) are dropped. A pending row comes back as completed in a
 *   later export and is imported then.
 * - The id is the export's own transaction id, prefixed with the provider
 *   and, for wallets with several balances, the currency: one Wise
 *   conversion has the same id on both balances.
 */

export type FintechRowResult = { row: ParsedCsvRow } | { skip: true } | { error: string };

/** Looks a cell up by one of its (normalised) header names; "" when absent. */
export type CellLookup = (...names: string[]) => string;

export interface FintechFormat {
  name: string;
  matches(headers: string[]): boolean;
  parseRow(cell: CellLookup, headers: string[]): FintechRowResult;
}

const SKIP = { skip: true } as const;

/** Builds a row, validating the parts every provider shares. */
function buildRow(input: {
  rawDate: string;
  utc: boolean;
  amount: string | null;
  rawAmount: string;
  currency: string;
  fee?: string | null;
  feeCurrency?: string | null;
  counterpartyName?: string | null;
  counterpartyAccount?: string | null;
  reference?: string | null;
  message?: string | null;
  externalId?: string | null;
}): FintechRowResult {
  const transactionDate = parseDate(input.rawDate, { utc: input.utc });
  if (!transactionDate) return { error: `invalid date "${input.rawDate}"` };
  if (input.amount === null) return { error: `invalid amount "${input.rawAmount}"` };
  const currency = input.currency.trim().toUpperCase();
  if (!CURRENCY_PATTERN.test(currency)) return { error: `invalid currency "${input.currency}"` };
  const feeCurrency = input.feeCurrency?.trim().toUpperCase();
  const fee = input.fee && Number(input.fee) !== 0 && (!feeCurrency || feeCurrency === currency) ? absolute(input.fee) : null;
  return {
    row: {
      transactionDate,
      amount: input.amount,
      currency,
      variableSymbol: extractVariableSymbol([input.reference]),
      counterpartyAccount: nullIfEmpty(input.counterpartyAccount ?? undefined),
      counterpartyName: nullIfEmpty(input.counterpartyName ?? undefined),
      message: nullIfEmpty(input.message ?? undefined),
      fee,
      externalId: input.externalId ?? null,
    },
  };
}

function absolute(amount: string): string {
  return amount.startsWith("-") ? amount.slice(1) : amount;
}

/** A blank fee is no fee; anything else must be a number. */
function optionalAmount(raw: string): string | null | undefined {
  if (raw.trim() === "") return null;
  return parseAmount(raw) ?? undefined;
}

function has(headers: string[], ...names: string[]): boolean {
  return names.every((name) => headers.includes(name));
}

function id(prefix: string, raw: string, currency?: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  return currency ? `${prefix}:${value}:${currency.trim().toUpperCase()}` : `${prefix}:${value}`;
}

/** "Payment from Novák s.r.o." → "Novák s.r.o." for exports with no payer column. */
function nameFromDescription(description: string, incoming: boolean): string | null {
  const pattern = incoming ? /^(?:payment|transfer|money added|money received) from\s+(.+)$/i : /^(?:to|payment to|transfer to)\s+(.+)$/i;
  return pattern.exec(description.trim())?.[1]?.trim() ?? null;
}

/**
 * Wise transaction history ("Transactions" → Download → CSV): one row per
 * transfer with Direction IN / OUT / NEUTRAL and source/target amounts
 * after fees. NEUTRAL is a conversion between own balances.
 */
const wiseHistory: FintechFormat = {
  name: "wise-history",
  matches: (h) => has(h, "direction", "source amount (after fees)", "target amount (after fees)"),
  parseRow(cell) {
    const status = cell("status").toUpperCase();
    if (status && status !== "COMPLETED") return SKIP;
    const direction = cell("direction").toUpperCase();
    if (direction === "NEUTRAL") return SKIP;
    if (direction !== "IN" && direction !== "OUT") return { error: `unknown direction "${cell("direction")}"` };
    const incoming = direction === "IN";
    const side = incoming ? "target" : "source";
    const rawAmount = cell(`${side} amount (after fees)`);
    const net = parseAmount(rawAmount);
    const fee = optionalAmount(cell(`${side} fee amount`));
    if (fee === undefined) return { error: `invalid fee "${cell(`${side} fee amount`)}"` };
    const currency = cell(`${side} currency`);
    const feeCurrency = cell(`${side} fee currency`);
    // "After fees": the payer sent net + fee, and an outgoing transfer took net + fee off the balance.
    const feeInCurrency = fee && (!feeCurrency || feeCurrency.toUpperCase() === currency.toUpperCase()) ? fee : "0";
    const gross = net === null ? null : addAmounts(absolute(net), absolute(feeInCurrency));
    const reference = cell("reference");
    return buildRow({
      rawDate: cell("finished on") || cell("created on"),
      utc: true,
      amount: gross === null ? null : incoming ? gross : negateAmount(gross),
      rawAmount,
      currency,
      fee,
      feeCurrency,
      counterpartyName: cell(incoming ? "source name" : "target name"),
      reference,
      message: reference || cell("note"),
      externalId: id("wise", cell("id"), currency),
    });
  },
};

/**
 * Wise balance statement ("Statements" → CSV): one row per balance
 * movement with a signed Amount (the change of the balance) and Total fees.
 */
const wiseStatement: FintechFormat = {
  name: "wise-statement",
  matches: (h) => (h.includes("transferwise id") || h.includes("wise id")) && has(h, "amount", "currency"),
  parseRow(cell) {
    const description = cell("description");
    const detailType = cell("transaction details type").toUpperCase();
    if (detailType === "CONVERSION" || (!detailType && /^converted\b/i.test(description))) return SKIP;
    const rawAmount = cell("amount");
    const amount = parseAmount(rawAmount);
    const fee = optionalAmount(cell("total fees"));
    if (fee === undefined) return { error: `invalid fee "${cell("total fees")}"` };
    const incoming = amount !== null && !amount.startsWith("-");
    // A credit is what is left after Wise's fee; a debit already includes it.
    const gross = amount !== null && incoming && fee ? addAmounts(amount, absolute(fee)) : amount;
    const reference = cell("payment reference");
    const currency = cell("currency");
    return buildRow({
      rawDate: cell("date time") || cell("date"),
      utc: true,
      amount: gross,
      rawAmount,
      currency,
      fee,
      counterpartyName: incoming ? cell("payer name") : cell("payee name") || cell("merchant"),
      counterpartyAccount: incoming ? null : cell("payee account number"),
      reference,
      message: reference || description,
      externalId: id("wise", cell("transferwise id", "wise id"), currency),
    });
  },
};

const REVOLUT_DONE = "COMPLETED";

/**
 * Revolut Business ("Date started (UTC)", "ID", "State", "Payment
 * currency"…) and personal ("Started Date", "Completed Date", "State",
 * "Fee"…) statements. Amount is signed and excludes the fee.
 */
const revolut: FintechFormat = {
  name: "revolut",
  matches: (h) =>
    h.includes("state") &&
    h.includes("amount") &&
    ["date completed (utc)", "date started (utc)", "completed date", "started date"].some((name) => h.includes(name)),
  parseRow(cell) {
    const state = cell("state").toUpperCase();
    if (state !== REVOLUT_DONE) return SKIP;
    if (cell("type").toUpperCase() === "EXCHANGE") return SKIP;
    const rawAmount = cell("amount");
    const amount = parseAmount(rawAmount);
    const fee = optionalAmount(cell("fee"));
    if (fee === undefined) return { error: `invalid fee "${cell("fee")}"` };
    const incoming = amount !== null && !amount.startsWith("-");
    const description = cell("description");
    const reference = cell("reference");
    const currency = cell("payment currency", "currency");
    return buildRow({
      rawDate: cell("date completed (utc)", "completed date") || cell("date started (utc)", "started date"),
      utc: true,
      amount,
      rawAmount,
      currency,
      fee,
      feeCurrency: cell("fee currency"),
      counterpartyName: (incoming ? cell("payer") : "") || nameFromDescription(description, incoming),
      counterpartyAccount: incoming ? null : cell("beneficiary iban", "beneficiary account number"),
      reference,
      message: reference || description,
      externalId: id("revolut", cell("id"), currency),
    });
  },
};

const PAID_COLUMN = /^paid (out|in)(?: \(([a-z]{3})\))?$/;

/** Older Revolut statements: "Completed Date", "Paid Out (EUR)", "Paid In (EUR)", the currency in the header. */
const revolutLegacy: FintechFormat = {
  name: "revolut-legacy",
  matches: (h) => h.includes("completed date") && h.some((name) => PAID_COLUMN.test(name)),
  parseRow(cell, headers) {
    const paidOutHeader = headers.find((name) => PAID_COLUMN.exec(name)?.[1] === "out") ?? "";
    const paidInHeader = headers.find((name) => PAID_COLUMN.exec(name)?.[1] === "in") ?? "";
    const currency = PAID_COLUMN.exec(paidInHeader || paidOutHeader)?.[2] ?? cell("currency");
    const description = cell("description", "reference");
    if (/^exchanged (to|from)\b/i.test(description)) return SKIP;
    const rawIn = paidInHeader ? cell(paidInHeader) : "";
    const rawOut = paidOutHeader ? cell(paidOutHeader) : "";
    if (!rawIn && !rawOut) return SKIP;
    const amount = rawIn ? parseAmount(rawIn) : (() => {
      const out = parseAmount(rawOut);
      return out === null ? null : negateAmount(absolute(out));
    })();
    const incoming = Boolean(rawIn);
    return buildRow({
      rawDate: cell("completed date"),
      utc: true,
      amount,
      rawAmount: rawIn || rawOut,
      currency,
      counterpartyName: nameFromDescription(description, incoming),
      reference: cell("reference"),
      message: description || cell("notes"),
    });
  },
};

/**
 * Stripe balance: the itemised "Balance change from activity" report
 * (balance_transaction_id, created_utc, gross, fee, net, reporting_category…)
 * and the older Dashboard balance export (id, Type, Source, Amount, Fee,
 * Net, Created (UTC)…). Every balance movement is kept, payouts included,
 * with the gross as the amount.
 */
const stripeBalance: FintechFormat = {
  name: "stripe-balance",
  matches: (h) => has(h, "net", "fee", "currency") && (h.includes("gross") || h.includes("amount")),
  parseRow(cell) {
    const rawAmount = cell("gross", "amount");
    const fee = optionalAmount(cell("fee"));
    if (fee === undefined) return { error: `invalid fee "${cell("fee")}"` };
    const category = cell("reporting_category", "reporting category", "type").toLowerCase();
    // A charge is keyed by its charge id, so the same payment from the Payments export is a known id.
    const chargeId = category === "charge" || category === "payment" ? cell("charge_id", "source_id", "source") : "";
    const description = cell("description");
    const utcDate = cell("created_utc", "created (utc)");
    return buildRow({
      rawDate: utcDate || cell("created"),
      utc: Boolean(utcDate),
      amount: parseAmount(rawAmount),
      rawAmount,
      currency: cell("currency"),
      fee,
      counterpartyName: cell("customer_name", "customer_description") || null,
      counterpartyAccount: cell("customer_email"),
      reference: description,
      message: description,
      externalId: id("stripe", chargeId || cell("balance_transaction_id", "id")),
    });
  },
};

const STRIPE_PAID = new Set(["paid", "succeeded", "partially refunded"]);

/**
 * Stripe Payments export (id, Created (UTC), Amount, Amount Refunded,
 * Currency, Captured, Fee, Status…). Only payments that were paid and are
 * not fully refunded count. The fee is in the settlement ("Converted")
 * currency, so it is kept only when that is the charge currency.
 */
const stripePayments: FintechFormat = {
  name: "stripe-payments",
  matches: (h) =>
    has(h, "id", "amount", "currency", "status") &&
    (h.includes("created (utc)") || h.includes("created date (utc)")) &&
    (h.includes("captured") || h.includes("amount refunded") || h.includes("converted amount")),
  parseRow(cell) {
    if (!STRIPE_PAID.has(cell("status").toLowerCase())) return SKIP;
    if (cell("captured").toLowerCase() === "false") return SKIP;
    const rawAmount = cell("amount");
    const fee = optionalAmount(cell("fee"));
    if (fee === undefined) return { error: `invalid fee "${cell("fee")}"` };
    const currency = cell("currency");
    const description = cell("description");
    return buildRow({
      rawDate: cell("created (utc)", "created date (utc)"),
      utc: true,
      amount: parseAmount(rawAmount),
      rawAmount,
      currency,
      fee,
      feeCurrency: cell("converted currency") || currency,
      counterpartyName: cell("customer name", "customer description") || null,
      counterpartyAccount: cell("customer email"),
      reference: description,
      message: description,
      externalId: id("stripe", cell("id")),
    });
  },
};

/** Order matters: the more specific header sets first. */
const FORMATS: FintechFormat[] = [wiseHistory, wiseStatement, revolutLegacy, revolut, stripeBalance, stripePayments];

export function detectFintechFormat(headers: string[]): FintechFormat | null {
  return FORMATS.find((format) => format.matches(headers)) ?? null;
}
