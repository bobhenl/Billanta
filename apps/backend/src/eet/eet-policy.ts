import { formatEetAmount, formatEetDateTime, type EetEnvironment, type EetResponse, type SendEetResult } from "@faktur/cz-compliance/eet";

/**
 * Which payments Billanta reports to EET 2.0 and with which values. Pure, so
 * the legal rules are tested without a database (eet-policy.spec.ts). See
 * docs/eet.md for the sources.
 */

export type BasePaymentMethod = "bank_transfer" | "cash" | "card" | "cash_on_delivery" | "other";

/**
 * Only a kontaktní platba is recorded (§ 5, 6 zákona č. 180/2026 Sb.): cash
 * always; a card only when the company takes cards in person (terminal at
 * the counter), since an online card payment is a remote one. A bank
 * transfer is remote. Dobírka is paid to the carrier, not to the seller, and
 * reaches the seller by transfer; "other" says nothing about how, so neither
 * is recorded (open question in the report).
 */
export function isContactPayment(method: BasePaymentMethod, cardInPerson: boolean): boolean {
  if (method === "cash") return true;
  if (method === "card") return cardInPerson;
  return false;
}

/** EET 2.0 starts on 1. 1. 2027 (§ 36); production sales before it are not recorded. */
export const EET_START = new Date("2027-01-01T00:00:00+01:00");

export type EetSkipReason =
  | "disabled"
  | "not_configured"
  | "not_contact_payment"
  | "before_start"
  | "no_czk_amount"
  | "zero_amount";

export interface EetPaymentInput {
  environment: EetEnvironment;
  method: BasePaymentMethod;
  cardInPerson: boolean;
  documentType: "invoice" | "proforma" | "credit_note" | "quote";
  currency: string;
  /** Home currency per 1 unit of `currency`, fixed at issue; null for CZK. */
  exchangeRate: string | null;
  /** What this payment added to amount_paid, in the invoice currency. */
  paidDelta: number;
  /** The CZK the user typed for this payment, if any. */
  receivedCzk?: number;
  /** The date the user gave for the payment; undefined = now. */
  paidAt?: Date;
  now: Date;
}

export type EetPaymentPlan =
  | { record: false; reason: EetSkipReason }
  | { record: true; kind: "sale" | "refund"; celkTrzba: string; datTrzby: string; saleAt: Date };

/**
 * The sale time is when the money was received (§ 16). A payment entered for
 * an earlier day keeps that day; one for today (the form sends a date
 * without a time) or a future one is the moment of the click.
 */
export function eetSaleTime(paidAt: Date | undefined, now: Date): Date {
  if (!paidAt || paidAt.getTime() >= now.getTime()) return now;
  const day = (d: Date) => formatEetDateTime(d).slice(0, 10);
  return day(paidAt) === day(now) ? now : paidAt;
}

/**
 * The amount in CZK (§ 17 odst. 1 písm. f); methodology item 12: a foreign
 * currency is converted the way the income is for income tax). The invoice's
 * own rate is the one its income is booked at; without one, the CZK the user
 * entered for the payment.
 */
export function eetAmountCzk(input: Pick<EetPaymentInput, "currency" | "exchangeRate" | "paidDelta" | "receivedCzk">): number | null {
  if (input.currency === "CZK") return input.paidDelta;
  const rate = input.exchangeRate == null ? NaN : Number(input.exchangeRate);
  if (Number.isFinite(rate) && rate > 0) return input.paidDelta * rate;
  if (input.receivedCzk != null && input.receivedCzk > 0) return Math.sign(input.paidDelta) * input.receivedCzk;
  return null;
}

export function planEetPayment(input: EetPaymentInput): EetPaymentPlan {
  if (!isContactPayment(input.method, input.cardInPerson)) return { record: false, reason: "not_contact_payment" };
  const saleAt = eetSaleTime(input.paidAt, input.now);
  if (input.environment === "production" && saleAt < EET_START) return { record: false, reason: "before_start" };
  const czk = eetAmountCzk(input);
  if (czk == null) return { record: false, reason: "no_czk_amount" };
  // Money paid out on a credit note is a refund: a negative record (§ 8).
  const refund = input.documentType === "credit_note";
  const signed = refund ? -Math.abs(czk) : Math.abs(czk);
  const celkTrzba = formatEetAmount(signed.toFixed(4));
  if (celkTrzba === "0.00") return { record: false, reason: "zero_amount" };
  return { record: true, kind: refund ? "refund" : "sale", celkTrzba, datTrzby: formatEetDateTime(saleAt), saleAt };
}

/**
 * Undoing a payment reverses what was recorded for the document: one
 * record with the negated net sum of its records that were not rejected.
 */
export function reversalAmount(records: { celkTrzba: string; status: string }[]): string | null {
  let cents = 0n;
  for (const r of records) {
    if (r.status === "rejected") continue;
    cents += BigInt(formatEetAmount(r.celkTrzba).replace(".", ""));
  }
  if (cents === 0n) return null;
  const neg = -cents;
  const abs = neg < 0n ? -neg : neg;
  return `${neg < 0n ? "-" : ""}${abs / 100n}.${(abs % 100n).toString().padStart(2, "0")}`;
}

/** § 20: sent again without delay, and within 48 hours of the sale at the latest. */
export const EET_RESEND_WINDOW_MS = 48 * 60 * 60 * 1000;

/** Every sweep (5 minutes) for the first half hour, then hourly, so a broken setup doesn't hammer the service. */
export function resendDue(attempts: number, lastAttemptAt: Date | null, now: Date): boolean {
  if (!lastAttemptAt) return true;
  const wait = attempts < 6 ? 4 * 60 * 1000 : 55 * 60 * 1000;
  return now.getTime() - lastAttemptAt.getTime() >= wait;
}

export type EetRecordStatus = "pending" | "confirmed" | "rejected" | "overdue";

export interface EetAttemptOutcome {
  status: EetRecordStatus;
  pok: string | null;
  test: boolean | null;
  lastError: string | null;
  warnings: { code: number; text: string }[];
  transactionId: string | null;
}

/**
 * What one attempt means for the record. Only error -1 and a missing or
 * garbled answer are worth another try; any other error is final (the data
 * or the certificate is wrong and the same message would fail again).
 * A pending record past the 48 hours is flagged overdue but still retried.
 */
export function attemptOutcome(result: SendEetResult, saleAt: Date, now: Date): EetAttemptOutcome {
  const waiting = now.getTime() - saleAt.getTime() > EET_RESEND_WINDOW_MS ? "overdue" : "pending";
  const retry = (lastError: string, transactionId: string | null = null): EetAttemptOutcome => ({
    status: waiting,
    pok: null,
    test: null,
    lastError,
    warnings: [],
    transactionId,
  });
  if (!result.sent) return retry(result.reason);
  const r: EetResponse = result.response;
  if (r.kind === "confirmed") {
    return { status: "confirmed", pok: r.pok, test: r.test, lastError: null, warnings: r.warnings, transactionId: result.transactionId };
  }
  if (r.kind === "error") {
    const code = `eet_error_${r.code}`;
    if (r.retryable) return { ...retry(code, result.transactionId), test: r.test, warnings: r.warnings };
    return { status: "rejected", pok: null, test: r.test, lastError: code, warnings: r.warnings, transactionId: result.transactionId };
  }
  return retry(r.kind === "fault" ? "soap_fault" : `unparseable_http_${result.httpStatus}`, result.transactionId);
}
