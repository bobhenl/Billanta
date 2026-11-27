import type { DocumentAmounts } from './vault-amounts.js';
import type { PaymentAmounts } from './vault-payments.js';

/*
 * "Roční audit plateb": before the tax return, every invoice of the year
 * against the money that really arrived (bank, PayPal, Stripe, Wise,
 * Revolut, card payments), and every incoming payment that no invoice
 * explains. Nothing is matched here: the pairing the bank reconciliation
 * already stored (bank_transactions.matched_invoice_id, transfer pairs,
 * PayPal conversions) is only read and compared.
 *
 * The server builds the inputs and the report from plain documents. With
 * sealed amounts (Důvěrný režim, category "amounts") it hands out the same
 * inputs with the envelopes instead of the sums, and the browser opens them
 * and builds the report with these same functions, as for net income.
 */

/** Differences under half a cent are rounding, as in the server's `markPaid`. */
export const AUDIT_EPSILON = 0.005;

/**
 * A payment that arrived in another currency than the invoice is compared in
 * the home currency at the ČNB (ECB for EUR companies) rate of its day. A
 * bank's or PayPal's own rate sits within about 1 % of it, so a difference up
 * to 1 % of the invoice is the conversion, not a missing payment.
 */
export const AUDIT_FX_TOLERANCE = 0.01;

export type AuditInvoiceStatus =
  /** The money found covers the invoice. */
  | 'paid'
  /** Covered once the provider's recorded fee is counted. */
  | 'paid_fee'
  | 'underpaid'
  | 'overpaid'
  /** Not paid, and no money found. */
  | 'unpaid'
  /** Marked paid (or partly paid) by hand, and no money found in any source. */
  | 'manual'
  /** Sealed amounts this browser has not opened (or the server, which never can). */
  | 'sealed'
  /** Money in another currency whose rate is not known: it cannot be compared. */
  | 'unverified';

export const AUDIT_INVOICE_STATUSES: readonly AuditInvoiceStatus[] = ['paid', 'paid_fee', 'underpaid', 'overpaid', 'unpaid', 'manual', 'sealed', 'unverified'];

/** One piece of money tied to an invoice: a bank/PayPal/Stripe/Wise row or a card payment. */
export interface AuditPayment {
  id: string;
  kind: 'bank' | 'card';
  /** `AuditSource.key`. */
  source: string;
  /** YYYY-MM-DD. */
  date: string;
  /** Gross, in `currency`; null while sealed (a card payment of a sealed document). */
  amount: number | null;
  currency: string;
  /** What the provider kept, in `currency`; null when the source does not say. */
  fee: number | null;
  /** Home currency per 1 unit of `currency` (1 for the home currency); null when unknown. */
  homeRate: number | null;
  /** The sealed payment's envelope, opened by the browser. */
  encAmount?: string | null;
}

export interface AuditInvoice {
  id: string;
  number: string;
  customer: string;
  currency: string;
  /** Total with VAT; null while sealed. */
  total: number | null;
  /** Home currency per 1 unit of `currency` on the paid (else issue) day; null when unknown. */
  rate: number | null;
  issueDate: string | null;
  dueDate: string | null;
  paidAt: string | null;
  paymentMethod: string;
  /** Billanta has it as paid, or a partial payment was recorded (by hand or from a source). */
  markedPaid: boolean;
  paidInFull: boolean;
  /** Fees entered on the invoice (`payment_fees`), in `currency`; null while sealed. */
  recordedFee: number | null;
  encAmounts?: string | null;
  payments: AuditPayment[];
}

/** What the stored reconciliation says about one incoming row. */
export interface AuditTransactionFacts {
  amount: number;
  externalId: string | null;
  status: 'unmatched' | 'matched' | 'ignored';
  matchedInvoiceId: string | null;
  /** Status of the matched document, null when it is not visible to this member. */
  matchedInvoiceStatus: string | null;
  matchedExpenseId: string | null;
  transferPairId: string | null;
  counterpartyName: string | null;
  counterpartyAccount: string | null;
  message: string | null;
}

export type AuditTransactionKind =
  /** Paired with an issued or paid document (or an expense refund). */
  | 'paired'
  /** Paired only with a draft, a document waiting for review or a cancelled one. */
  | 'not_issued'
  | 'no_invoice'
  /** Ignored by a person or a bank rule. */
  | 'ignored'
  /** The bank leg of the company's own PayPal withdrawal. */
  | 'transfer'
  /** A PayPal balance conversion. */
  | 'conversion';

export interface AuditTransaction extends AuditTransactionFacts {
  id: string;
  kind: 'bank' | 'card';
  source: string;
  date: string;
  currency: string;
  /** 0 with `amountUnknown` while sealed (card payment of a sealed document). */
  amount: number;
  fee: number | null;
  homeRate: number | null;
  variableSymbol: string | null;
  matchedInvoiceNumber: string | null;
  encAmount?: string | null;
  /** Set for a sealed card payment the browser has not opened. */
  amountUnknown?: boolean;
}

export interface AuditSource {
  /** `c:<connection id>`, `paypal`, `stripe`, `wise`, `revolut`, `upload`, `card`… */
  key: string;
  /** The connection's own name; null = the frontend names it after the key. */
  label: string | null;
  provider: string;
}

export interface PaymentAuditInputs {
  year: number;
  /** YYYY-MM-DD, `to` exclusive. */
  from: string;
  to: string;
  home: string;
  sources: AuditSource[];
  invoices: AuditInvoice[];
  /** Every incoming row of the year (card payments included). */
  transactions: AuditTransaction[];
}

export interface AuditInvoiceRow {
  id: string;
  number: string;
  customer: string;
  currency: string;
  total: number | null;
  issueDate: string | null;
  dueDate: string | null;
  paidAt: string | null;
  paymentMethod: string;
  status: AuditInvoiceStatus;
  /** Gross money found, in the invoice currency (converted when it came in another one). */
  received: number | null;
  /** Fees known for it, in the invoice currency. */
  fee: number;
  /** Still missing (positive) or paid on top (negative), in the invoice currency. */
  difference: number | null;
  differenceHome: number | null;
  sources: string[];
  paymentIds: string[];
}

export interface AuditTransactionRow {
  id: string;
  kind: 'bank' | 'card';
  source: string;
  date: string;
  amount: number | null;
  currency: string;
  fee: number | null;
  homeAmount: number | null;
  counterpartyName: string | null;
  variableSymbol: string | null;
  message: string | null;
  status: Extract<AuditTransactionKind, 'no_invoice' | 'not_issued' | 'ignored'>;
  /** A credit from PayPal that no withdrawal explains: most likely the company's own transfer. */
  likelyTransfer: boolean;
  matchedInvoiceId: string | null;
  matchedInvoiceNumber: string | null;
}

export interface AuditBucket {
  count: number;
  amount: number;
}

export interface AuditSourceRow {
  source: string;
  currency: string;
  incoming: AuditBucket;
  paired: AuditBucket;
  withoutInvoice: AuditBucket;
  ignored: AuditBucket;
  /** Own transfers and conversions: listed, never income. */
  ownMoves: AuditBucket;
  fees: number;
  /** Incoming money (own moves left out) in the home currency; null when some row has no rate. */
  homeAmount: number | null;
  /** Sealed card payments not opened: counted, not summed. */
  unknownAmounts: number;
}

export interface PaymentAuditReport {
  year: number;
  home: string;
  invoices: AuditInvoiceRow[];
  transactions: AuditTransactionRow[];
  sources: AuditSourceRow[];
  /** What each source key is called (the inputs' `sources`). */
  sourceNames: AuditSource[];
  totals: {
    byStatus: Record<AuditInvoiceStatus, number>;
    /** What the underpaid invoices still miss, in the home currency (those with a rate). */
    underpaidHome: number;
    overpaidHome: number;
    /** Fees of the year's invoices, in the home currency. */
    feesHome: number;
    withoutInvoice: AuditBucket & { homeAmount: number };
  };
}

const round2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;

// ---------------------------------------------------------------- invoices

export interface InvoiceVerdict {
  status: AuditInvoiceStatus;
  received: number | null;
  fee: number;
  difference: number | null;
  differenceHome: number | null;
}

/**
 * Compares an invoice with the money paired to it. In its own currency when
 * every payment came in it (to the half cent); otherwise in the home
 * currency, with `AUDIT_FX_TOLERANCE` for the conversion. A shortfall that
 * the recorded fee explains is "paid, fee X", never underpaid.
 */
export function auditInvoice(invoice: AuditInvoice): InvoiceVerdict {
  const none = { received: null, fee: 0, difference: null, differenceHome: null };
  if (invoice.total == null || invoice.payments.some((p) => p.amount == null)) return { status: 'sealed', ...none };
  const total = invoice.total;
  const payments = invoice.payments as (AuditPayment & { amount: number })[];
  if (payments.length === 0) return { status: invoice.markedPaid ? 'manual' : 'unpaid', ...none, difference: total, differenceHome: invoice.rate == null ? null : round2(total * invoice.rate) };

  const paymentFees = payments.reduce((s, p) => s + Math.abs(p.fee ?? 0), 0);
  const sameCurrency = payments.every((p) => p.currency === invoice.currency);
  let received: number;
  let fee: number;
  let tolerance: number;
  if (sameCurrency) {
    received = payments.reduce((s, p) => s + p.amount, 0);
    // The reconciliation adds each payment's fee to payment_fees; a fee typed by hand is there too.
    fee = Math.max(paymentFees, invoice.recordedFee ?? 0);
    tolerance = AUDIT_EPSILON;
  } else {
    const rate = invoice.rate;
    if (rate == null || !(rate > 0) || payments.some((p) => p.homeRate == null)) {
      return { status: 'unverified', ...none };
    }
    // Everything in the home currency, then back to the invoice currency at the invoice's rate.
    const home = payments.reduce((s, p) => s + p.amount * p.homeRate!, 0);
    const feeHome = payments.reduce((s, p) => s + Math.abs(p.fee ?? 0) * p.homeRate!, 0);
    received = home / rate;
    fee = Math.max(feeHome / rate, invoice.recordedFee ?? 0);
    tolerance = Math.max(AUDIT_EPSILON, Math.abs(total) * AUDIT_FX_TOLERANCE);
  }
  received = round2(received);
  fee = round2(fee);
  const difference = round2(total - received);
  const differenceHome = invoice.rate == null ? null : round2(difference * invoice.rate);
  const verdict = (status: AuditInvoiceStatus): InvoiceVerdict => ({ status, received, fee, difference, differenceHome });

  if (Math.abs(difference) <= tolerance) return verdict(fee > 0 ? 'paid_fee' : 'paid');
  if (difference < 0) return verdict('overpaid');
  // What arrived is the net after the provider's fee (Stripe payouts, some CSV exports).
  if (fee > 0 && Math.abs(difference - fee) <= tolerance) return verdict('paid_fee');
  return verdict('underpaid');
}

// ---------------------------------------------------------------- incoming money

/** A bank credit sent by PayPal (same test as transfer-pairing.ts). */
export function isPaypalCreditFacts(tx: Pick<AuditTransactionFacts, 'amount' | 'counterpartyName' | 'counterpartyAccount'>): boolean {
  return tx.amount > 0 && /pay\s*pal/i.test(`${tx.counterpartyName ?? ''} ${tx.counterpartyAccount ?? ''}`);
}

const NOT_ISSUED = new Set(['draft', 'pending_review', 'cancelled']);

/**
 * Where one incoming row stands, from what the reconciliation stored. Own
 * money moving (a PayPal withdrawal's bank leg, a PayPal conversion) comes
 * first: those rows are "ignored" too, but they are not income at all.
 */
export function auditTransactionKind(tx: AuditTransactionFacts): AuditTransactionKind {
  const paypal = tx.externalId?.startsWith('paypal:') ?? false;
  if (!paypal && tx.transferPairId) return 'transfer';
  // As paypalMovement in the frontend: the conversion rows carry "100.00 USD → 2300.00 CZK" and no payer.
  if (paypal && tx.status === 'ignored' && !tx.counterpartyName && tx.message?.includes('→')) return 'conversion';
  if (tx.matchedExpenseId) return 'paired';
  if (tx.matchedInvoiceId) return tx.matchedInvoiceStatus && NOT_ISSUED.has(tx.matchedInvoiceStatus) ? 'not_issued' : 'paired';
  if (tx.status === 'ignored') return 'ignored';
  return 'no_invoice';
}

const bucket = (): AuditBucket => ({ count: 0, amount: 0 });
const add = (b: AuditBucket, amount: number | null) => {
  b.count++;
  if (amount != null) b.amount = round2(b.amount + amount);
};

export function paymentAuditOf(inputs: PaymentAuditInputs): PaymentAuditReport {
  const byStatus = Object.fromEntries(AUDIT_INVOICE_STATUSES.map((s) => [s, 0])) as Record<AuditInvoiceStatus, number>;
  let underpaidHome = 0;
  let overpaidHome = 0;
  let feesHome = 0;
  const invoices: AuditInvoiceRow[] = inputs.invoices.map((invoice) => {
    const v = auditInvoice(invoice);
    byStatus[v.status]++;
    if (v.status === 'underpaid' && v.differenceHome != null) underpaidHome += v.differenceHome;
    if (v.status === 'overpaid' && v.differenceHome != null) overpaidHome -= v.differenceHome;
    if (invoice.rate != null) feesHome += v.fee * invoice.rate;
    return {
      id: invoice.id,
      number: invoice.number,
      customer: invoice.customer,
      currency: invoice.currency,
      total: invoice.total,
      issueDate: invoice.issueDate,
      dueDate: invoice.dueDate,
      paidAt: invoice.paidAt,
      paymentMethod: invoice.paymentMethod,
      status: v.status,
      received: v.received,
      fee: v.fee,
      difference: v.difference,
      differenceHome: v.differenceHome,
      sources: [...new Set(invoice.payments.map((p) => p.source))],
      paymentIds: invoice.payments.map((p) => p.id),
    };
  });

  const rows = new Map<string, AuditSourceRow>();
  const transactions: AuditTransactionRow[] = [];
  const withoutInvoice = { ...bucket(), homeAmount: 0 };
  for (const tx of inputs.transactions) {
    const kind = auditTransactionKind(tx);
    const amount = tx.amountUnknown ? null : tx.amount;
    const homeAmount = amount != null && tx.homeRate != null ? round2(amount * tx.homeRate) : null;
    const rowKey = `${tx.source}|${tx.currency}`;
    let row = rows.get(rowKey);
    if (!row) {
      row = { source: tx.source, currency: tx.currency, incoming: bucket(), paired: bucket(), withoutInvoice: bucket(), ignored: bucket(), ownMoves: bucket(), fees: 0, homeAmount: 0, unknownAmounts: 0 };
      rows.set(rowKey, row);
    }
    if (kind === 'transfer' || kind === 'conversion') {
      add(row.ownMoves, amount);
      continue;
    }
    add(row.incoming, amount);
    if (amount == null) row.unknownAmounts++;
    if (tx.fee) row.fees = round2(row.fees + Math.abs(tx.fee));
    row.homeAmount = row.homeAmount == null || (amount != null && homeAmount == null) ? null : round2(row.homeAmount + (homeAmount ?? 0));
    if (kind === 'paired') {
      add(row.paired, amount);
      continue;
    }
    if (kind === 'ignored') add(row.ignored, amount);
    else {
      add(row.withoutInvoice, amount);
      add(withoutInvoice, amount);
      withoutInvoice.homeAmount = round2(withoutInvoice.homeAmount + (homeAmount ?? 0));
    }
    transactions.push({
      id: tx.id,
      kind: tx.kind,
      source: tx.source,
      date: tx.date,
      amount,
      currency: tx.currency,
      fee: tx.fee,
      homeAmount,
      counterpartyName: tx.counterpartyName,
      variableSymbol: tx.variableSymbol,
      message: tx.message,
      status: kind,
      likelyTransfer: isPaypalCreditFacts(tx),
      matchedInvoiceId: tx.matchedInvoiceId,
      matchedInvoiceNumber: tx.matchedInvoiceNumber,
    });
  }

  return {
    year: inputs.year,
    home: inputs.home,
    invoices,
    transactions,
    sources: [...rows.values()].sort((a, b) => a.source.localeCompare(b.source) || a.currency.localeCompare(b.currency)),
    sourceNames: inputs.sources,
    totals: { byStatus, underpaidHome: round2(underpaidHome), overpaidHome: round2(overpaidHome), feesHome: round2(feesHome), withoutInvoice },
  };
}

// ---------------------------------------------------------------- sealed amounts

/** The envelopes the browser has to open: document totals and sealed card payments. */
export function paymentAuditEnvelopes(inputs: PaymentAuditInputs): { documents: string[]; payments: string[] } {
  const documents = inputs.invoices.filter((i) => i.total == null && i.encAmounts).map((i) => i.encAmounts!);
  const payments = [
    ...inputs.invoices.flatMap((i) => i.payments.filter((p) => p.amount == null && p.encAmount).map((p) => p.encAmount!)),
    ...inputs.transactions.filter((t) => t.amountUnknown && t.encAmount).map((t) => t.encAmount!),
  ];
  return { documents: [...new Set(documents)], payments: [...new Set(payments)] };
}

/**
 * The inputs with what the browser opened filled in. An envelope it could
 * not open stays null, so its invoice keeps the "sealed" status instead of
 * looking unpaid; `missing` counts those invoices.
 */
export function openPaymentAuditInputs(
  inputs: PaymentAuditInputs,
  documents: Map<string, DocumentAmounts>,
  payments: Map<string, PaymentAmounts>,
): { inputs: PaymentAuditInputs; missing: number } {
  const payment = <T extends { amount: number | null; fee: number | null; encAmount?: string | null }>(p: T): T => {
    const opened = p.amount == null && p.encAmount ? payments.get(p.encAmount) : undefined;
    return opened ? { ...p, amount: opened.amount, fee: opened.fee || p.fee } : p;
  };
  let missing = 0;
  const invoices = inputs.invoices.map((invoice) => {
    const opened = invoice.total == null && invoice.encAmounts ? documents.get(invoice.encAmounts) : undefined;
    const next: AuditInvoice = {
      ...invoice,
      total: opened ? opened.totalWithVat : invoice.total,
      // A sealed document's fees live in its payments' envelopes; payment_fees stays 0 in plain.
      recordedFee: invoice.recordedFee ?? 0,
      payments: invoice.payments.map(payment),
    };
    if (next.total == null || next.payments.some((p) => p.amount == null)) missing++;
    return next;
  });
  const transactions = inputs.transactions.map((tx) => {
    if (!tx.amountUnknown || !tx.encAmount) return tx;
    const opened = payments.get(tx.encAmount);
    return opened ? { ...tx, amount: opened.amount, fee: opened.fee || tx.fee, amountUnknown: false } : tx;
  });
  return { inputs: { ...inputs, invoices, transactions }, missing };
}
