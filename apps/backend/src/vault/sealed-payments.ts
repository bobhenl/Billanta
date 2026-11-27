import { BadRequestException, ConflictException } from "@nestjs/common";
import { documentKeyWrap, isSealed } from "@faktur/cz-compliance";
import { AMOUNTS_PLAINTEXT, amountsSealed } from "./sealed-amounts";

/*
 * Payments of a document whose amounts are sealed (migration 0117). The
 * browser opens the total and the earlier payments, seals the new payment
 * under the same document key and says what the document is now: paid,
 * partly paid or (after removing one) unpaid. The server cannot check the
 * sums, so it checks everything else: the envelope belongs to this document,
 * the verdict fits the number of payments left, the document can be paid.
 */

export type SealedPaymentVerdict = "unpaid" | "partly_paid" | "paid";

type PayableDoc = { encAmounts?: string | null; status: string; documentType: string };

/** 409 `amounts_plain` for a document whose amounts the server can read: it uses mark-paid. */
export function assertSealedPayable(invoice: PayableDoc, action: "add" | "remove"): void {
  if (!amountsSealed(invoice)) throw new ConflictException("amounts_plain");
  if (invoice.documentType === "quote") throw new BadRequestException("A quote is not paid");
  const allowed = action === "add" ? ["issued"] : ["issued", "paid"];
  if (!allowed.includes(invoice.status)) throw new BadRequestException("invoice_not_payable");
}

/**
 * The payment's envelope is sealed under the document's own key. A payment
 * sealed under another document's key would open as "locked" here and
 * quietly leave the balance short.
 */
export function assertPaymentEnvelope(invoice: { encAmounts?: string | null }, encAmount: string): void {
  if (!isSealed(encAmount)) throw new BadRequestException(AMOUNTS_PLAINTEXT);
  const wrap = documentKeyWrap(invoice.encAmounts);
  if (!wrap || documentKeyWrap(encAmount) !== wrap) throw new BadRequestException("document_key_mismatch");
}

/**
 * The browser's verdict must fit what the server can count: no payments
 * left means unpaid, and some payments are never "unpaid" (a payment is
 * always more than 0, the envelope refuses less).
 */
export function assertVerdict(verdict: SealedPaymentVerdict, paymentsLeft: number): void {
  if ((paymentsLeft === 0) !== (verdict === "unpaid")) throw new BadRequestException("payment_state_mismatch");
}

/**
 * What the invoice row becomes. Any change of payments also drops a card
 * amount the user allowed earlier: it was the rest due then, not now.
 */
export function sealedPaymentSet(
  verdict: SealedPaymentVerdict,
  current: { status: string; paidAt: Date | null },
  paidAt: Date,
): { status: "issued" | "paid"; paidAt: Date | null; sealedPaymentState: "partly_paid" | null; cardAmount: null } {
  if (verdict === "paid") return { status: "paid", paidAt: current.status === "paid" && current.paidAt ? current.paidAt : paidAt, sealedPaymentState: null, cardAmount: null };
  return { status: "issued", paidAt: null, sealedPaymentState: verdict === "partly_paid" ? "partly_paid" : null, cardAmount: null };
}

/**
 * "Platba kartou" for a sealed document: the one amount the user opted to
 * reveal, for an issued invoice or proforma only. Null switches it off.
 */
export function assertCardAmount(invoice: PayableDoc, amount: number | null): void {
  if (!amountsSealed(invoice)) throw new ConflictException("amounts_plain");
  if (amount == null) return;
  if (invoice.status !== "issued" || !["invoice", "proforma"].includes(invoice.documentType)) {
    throw new BadRequestException("invoice_not_payable");
  }
  if (!(amount > 0 && amount < 1e9) || Math.abs(Math.round(amount * 100) - amount * 100) > 1e-6) throw new BadRequestException("Invalid amount");
}
