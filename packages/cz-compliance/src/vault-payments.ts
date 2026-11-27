import { generateQrInvoiceString, qrInvoiceForSpayd, type QrInvoiceParams } from './qr-faktura.js';
import { generateSpaydString } from './spayd.js';
import type { DocumentAmounts } from './vault-amounts.js';

/**
 * Payments of a document whose amounts are sealed ("Důvěrný režim",
 * category "amounts"). Each payment's sum, the provider's fee and what
 * arrived in the home currency are sealed in the browser under the
 * document's key. The server keeps only the date, the VS, the matched bank
 * transaction and a state the browser computed from the opened numbers.
 */

export interface PaymentAmounts {
  amount: number;
  /** What the payment provider kept, in the document currency. */
  fee: number;
  /** A foreign-currency document paid in the home currency: what arrived. */
  receivedHome: number | null;
}

/** What the server stores next to the payments: a browser verdict, never a sum. */
export type SealedPaymentState = 'unpaid' | 'partly_paid' | 'paid';

/** Differences under half a cent are rounding, as in the server's `markPaid`. */
const EPSILON = 0.005;

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function finite(value: unknown, field: string): number {
  const n = typeof value === 'string' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isFinite(n)) throw new Error(`payment_${field}`);
  return n;
}

export function encodePaymentAmounts(p: PaymentAmounts): string {
  const amount = finite(p.amount, 'amount');
  if (amount <= 0) throw new Error('payment_amount');
  const fee = finite(p.fee ?? 0, 'fee');
  if (fee < 0) throw new Error('payment_fee');
  return JSON.stringify({
    amount: round2(amount),
    fee: round2(fee),
    receivedHome: p.receivedHome == null ? null : round2(finite(p.receivedHome, 'received')),
  });
}

/** Throws on anything that is not a payment, so a wrong envelope never counts as paid. */
export function decodePaymentAmounts(plain: string): PaymentAmounts {
  const raw = JSON.parse(plain) as Record<string, unknown>;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('payment_shape');
  const amount = finite(raw.amount, 'amount');
  if (amount <= 0) throw new Error('payment_amount');
  return {
    amount,
    fee: finite(raw.fee ?? 0, 'fee'),
    receivedHome: raw.receivedHome == null ? null : finite(raw.receivedHome, 'received'),
  };
}

export interface SealedBalance {
  paid: number;
  remaining: number;
  fees: number;
  /** Null when no payment says what arrived in the home currency. */
  receivedHome: number | null;
  state: SealedPaymentState;
}

/** The opened payments against the opened total, the way `markPaid` sums plain ones. */
export function sealedBalance(total: number, payments: PaymentAmounts[]): SealedBalance {
  const paid = round2(payments.reduce((acc, p) => acc + p.amount, 0));
  const fees = round2(payments.reduce((acc, p) => acc + (p.fee ?? 0), 0));
  const homes = payments.filter((p) => p.receivedHome != null);
  const receivedHome = homes.length ? round2(homes.reduce((acc, p) => acc + (p.receivedHome ?? 0), 0)) : null;
  const state: SealedPaymentState = payments.length === 0 || paid <= EPSILON ? 'unpaid' : paid >= total - EPSILON ? 'paid' : 'partly_paid';
  return { paid, remaining: state === 'paid' ? 0 : round2(Math.max(0, total - paid)), fees, receivedHome, state };
}

// ---------------------------------------------------------------- bank matching

export interface MatchTransaction {
  id: string;
  amount: number;
  currency: string;
  variableSymbol: string | null;
  /** YYYY-MM-DD or an ISO timestamp. */
  transactionDate: string;
}

export interface MatchDocument {
  id: string;
  currency: string;
  variableSymbol: string | null;
  issueDate: string | null;
  dueDate: string | null;
  /** What is left to pay, from the opened total and payments. */
  remaining: number;
}

export type SealedMatchReason = 'vs_amount' | 'vs_partial' | 'amount_date';

export interface SealedMatchSuggestion {
  transactionId: string;
  invoiceId: string;
  reason: SealedMatchReason;
  /** Another document fits equally well: the user has to pick. */
  ambiguous: boolean;
}

const DAY = 86_400_000;
/** An amount-only match must arrive this close to the document's dates. */
const AMOUNT_ONLY_WINDOW_DAYS = 60;

const RANK: Record<SealedMatchReason, number> = { vs_amount: 3, vs_partial: 2, amount_date: 1 };

function day(value: string): number {
  return Date.parse(`${value.slice(0, 10)}T00:00:00Z`);
}

function normalizedVs(value: string | null | undefined): string | null {
  const vs = (value ?? '').replace(/\D/g, '').replace(/^0+/, '');
  return vs || null;
}

function reasonFor(tx: MatchTransaction, doc: MatchDocument): SealedMatchReason | null {
  if (tx.currency.toUpperCase() !== doc.currency.toUpperCase() || doc.remaining <= EPSILON || tx.amount <= 0) return null;
  const sameAmount = Math.abs(tx.amount - doc.remaining) < EPSILON;
  const vs = normalizedVs(tx.variableSymbol);
  if (vs && vs === normalizedVs(doc.variableSymbol)) {
    if (sameAmount) return 'vs_amount';
    return tx.amount < doc.remaining ? 'vs_partial' : null;
  }
  // A payment with somebody else's symbol is not this document's, whatever the amount.
  if (vs || !sameAmount) return null;
  const at = day(tx.transactionDate);
  const from = doc.issueDate ? day(doc.issueDate) : null;
  const to = day(doc.dueDate ?? doc.issueDate ?? tx.transactionDate) + AMOUNT_ONLY_WINDOW_DAYS * DAY;
  if (from != null && at < from) return null;
  return at <= to ? 'amount_date' : null;
}

/**
 * Suggestions only: the browser compares open bank transactions with the
 * opened sealed documents (the server cannot, it knows no amounts) and the
 * user confirms each one. One suggestion per transaction, the best fit; a
 * tie between documents is marked `ambiguous` instead of being guessed.
 */
export function suggestSealedMatches(transactions: MatchTransaction[], docs: MatchDocument[]): SealedMatchSuggestion[] {
  const out: SealedMatchSuggestion[] = [];
  for (const tx of transactions) {
    const fits = docs
      .map((doc) => ({ doc, reason: reasonFor(tx, doc) }))
      .filter((f): f is { doc: MatchDocument; reason: SealedMatchReason } => f.reason != null)
      .sort((a, b) => RANK[b.reason] - RANK[a.reason]);
    const best = fits[0];
    if (!best) continue;
    const ambiguous = fits.length > 1 && RANK[fits[1]!.reason] === RANK[best.reason];
    out.push({ transactionId: tx.id, invoiceId: best.doc.id, reason: best.reason, ambiguous });
  }
  return out;
}

// ---------------------------------------------------------------- QR Faktura

/**
 * The QR Faktura (SID) of a sealed document without its amounts: everything
 * `generateQrInvoiceString` needs except the total and the VAT recap, JSON
 * safe (dates as YYYY-MM-DD). The browser adds the opened totals.
 */
export interface SealedQrInvoicePlan {
  invoiceNumber: string;
  issueDate: string;
  currency: string;
  dueDate?: string;
  taxableSupplyDate?: string;
  variableSymbol?: string;
  orderNumber?: string;
  supplierIco?: string;
  supplierDic?: string;
  customerIco?: string;
  customerDic?: string;
  /** The supplier is a VAT payer: the code carries the VAT recap. */
  vatPayer: boolean;
  documentType?: 0 | 1;
  advance: boolean;
  reverseCharge: boolean;
  iban?: string;
  exchangeRate?: number;
  software?: string;
}

const asDate = (value: string | undefined) => (value ? new Date(`${value.slice(0, 10)}T00:00:00Z`) : undefined);

/** The standalone `SID*1.0*…` string once the totals are open. */
export function sealedQrInvoiceString(plan: SealedQrInvoicePlan, totals: DocumentAmounts): string {
  const params: QrInvoiceParams = {
    invoiceNumber: plan.invoiceNumber,
    issueDate: asDate(plan.issueDate)!,
    totalAmount: totals.totalWithVat,
    currency: plan.currency,
    dueDate: asDate(plan.dueDate),
    taxableSupplyDate: asDate(plan.taxableSupplyDate),
    variableSymbol: plan.variableSymbol,
    orderNumber: plan.orderNumber,
    supplierIco: plan.supplierIco,
    supplierDic: plan.supplierDic,
    customerIco: plan.customerIco,
    customerDic: plan.customerDic,
    vatLines: plan.vatPayer ? totals.byRate.map((r) => ({ rate: r.vatRatePercent, base: r.totalWithoutVat, vat: r.vatAmount })) : [],
    documentType: plan.documentType,
    advance: plan.advance,
    reverseCharge: plan.reverseCharge,
    iban: plan.iban,
    exchangeRate: plan.exchangeRate,
    software: plan.software,
  };
  return generateQrInvoiceString(params);
}

/** JSON-safe SPAYD inputs without the amount (the `spayd` kind of `SealedPdfQrPlan`). */
export interface SealedSpaydParams {
  iban: string;
  currency: string;
  variableSymbol?: string;
  dueDate?: string;
  message?: string;
  /** "QR Platba + Faktura": the invoice to embed as X-INV once the totals are open. */
  invoice?: SealedQrInvoicePlan;
}

/** The SPAYD string of a sealed document: the amount due, and the invoice embedded when the totals are known. */
export function sealedSpaydString(params: SealedSpaydParams, amount: number, totals: DocumentAmounts | null): string {
  const { invoice, dueDate, ...rest } = params;
  return generateSpaydString({
    ...rest,
    amount,
    dueDate: asDate(dueDate),
    invoice: invoice && totals ? qrInvoiceForSpayd(sealedQrInvoiceString(invoice, totals)) : undefined,
  });
}
