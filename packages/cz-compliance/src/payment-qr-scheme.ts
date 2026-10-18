/**
 * Which payment QR standard to print on an invoice.
 *
 * Czech banking apps read QR Platba (SPAYD, Czech Banking Association,
 * qr-platba.cz). Slovak banking apps read PAY by square (Slovak Banking
 * Association, bsqr.co/schema). Neither reads the other's code reliably, so
 * the code follows the payer's bank, which we can only guess:
 *
 * - a Slovak payee IBAN means the payment is a Slovak domestic (SEPA)
 *   transfer, so the payer most likely banks in Slovakia;
 * - an EUR invoice to a Slovak buyer is paid from a Slovak account even when
 *   the seller banks in Czechia;
 * - everything else (CZK, Czech buyers, other countries) keeps SPAYD, which
 *   is also the only one of the two that can carry QR Faktura (X-INV).
 *
 * This module is dependency-free so client bundles can import it from the
 * package index. The encoder itself lives in `pay-by-square.ts`, exported as
 * the `@faktur/cz-compliance/pay-by-square` subpath.
 */

export type PaymentQrScheme = 'spayd' | 'pay_by_square';

export interface PaymentQrSchemeInput {
  /** IBAN the payment goes to. */
  payeeIban: string;
  /** ISO 4217 currency of the amount to pay. */
  currency: string;
  /** ISO 3166-1 alpha-2 country of the buyer, if known. */
  buyerCountry?: string | null;
}

export function paymentQrScheme(input: PaymentQrSchemeInput): PaymentQrScheme {
  const iban = input.payeeIban.replace(/\s+/g, '').toUpperCase();
  if (iban.startsWith('SK')) return 'pay_by_square';
  const currency = input.currency.trim().toUpperCase();
  const buyer = (input.buyerCountry ?? '').trim().toUpperCase();
  if (currency === 'EUR' && buyer === 'SK') return 'pay_by_square';
  return 'spayd';
}
