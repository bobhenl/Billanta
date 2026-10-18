/**
 * PAY by square generator, the Slovak counterpart of SPAYD.
 *
 * PAY by square is the Slovak Banking Association's standard for payment QR
 * codes (spec: https://bsqr.co/schema/, current version 1.2.0). Unlike SPAYD
 * it is not plain text: the fields are tab-joined, prefixed with a CRC32,
 * LZMA-compressed and base32hex-encoded. The compression and header layout
 * are easy to get subtly wrong, so we use the `bysquare` library (Filip
 * Seman, Apache-2.0, https://github.com/xseman/bysquare) and only map our
 * invoice fields onto its data model. See THIRD_PARTY_NOTICES.md.
 *
 * Exported as the `@faktur/cz-compliance/pay-by-square` subpath, not from the
 * package index: `bysquare` pulls in `validator`, and the index is imported
 * by client components that never draw a QR code.
 */
import { encode, PaymentOptions } from 'bysquare/pay';

export interface PayBySquareParams {
  /** Beneficiary IBAN. Required. */
  iban: string;
  /** Optional BIC of the beneficiary's bank. */
  bic?: string;
  /** Amount to pay. Omit to let the payer type it. */
  amount?: number;
  /** ISO 4217 currency code. Defaults to "EUR". */
  currency?: string;
  /** Variable symbol, up to 10 digits. */
  variableSymbol?: string;
  /** Constant symbol, up to 4 digits. */
  constantSymbol?: string;
  /** Specific symbol, up to 10 digits. */
  specificSymbol?: string;
  /** Note for the payee ("správa pre prijímateľa"), cut to 140 chars. */
  message?: string;
  /** Payment due date (UTC calendar day). */
  dueDate?: Date;
  /** Beneficiary name. Required by spec 1.2.0. */
  beneficiaryName: string;
  beneficiaryStreet?: string;
  beneficiaryCity?: string;
  /**
   * Invoice number, carried as the document's InvoiceID. The field holds at
   * most 10 characters; a longer number is left out rather than cut, since a
   * cut number would point at a different invoice. Put it in `message` too.
   */
  invoiceId?: string;
}

function formatDate(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

/** Symbols are digit-only in the spec; drop anything else rather than fail the whole QR. */
function digits(value: string | undefined, max: number): string | undefined {
  const cleaned = (value ?? '').replace(/\D/g, '').slice(0, max);
  return cleaned || undefined;
}

function text(value: string | undefined, max: number): string | undefined {
  const cleaned = (value ?? '').trim().slice(0, max);
  return cleaned || undefined;
}

/**
 * Encodes one payment order as a PAY by square string, ready to be rendered
 * as a QR code. Diacritics are removed (the library's `deburr`), as the spec
 * recommends for compatibility with older banking apps.
 *
 * @throws {Error} if `iban` or `beneficiaryName` is empty, or the library's
 * validation rejects the IBAN or BIC.
 */
export function generatePayBySquareString(params: PayBySquareParams): string {
  const iban = params.iban.replace(/\s+/g, '').toUpperCase();
  if (!iban) throw new Error('generatePayBySquareString: "iban" is required');
  const beneficiaryName = text(params.beneficiaryName, 70);
  if (!beneficiaryName) throw new Error('generatePayBySquareString: "beneficiaryName" is required');

  const invoiceId = params.invoiceId?.trim();
  const bic = params.bic?.replace(/\s+/g, '').toUpperCase();
  return encode(
    {
      invoiceId: invoiceId && invoiceId.length <= 10 ? invoiceId : undefined,
      payments: [
        {
          type: PaymentOptions.PaymentOrder,
          // Two decimals, the same rounding the PDF totals use.
          amount: params.amount === undefined ? undefined : Math.round(params.amount * 100) / 100,
          currencyCode: (params.currency ?? 'EUR').toUpperCase(),
          paymentDueDate: params.dueDate ? formatDate(params.dueDate) : undefined,
          variableSymbol: digits(params.variableSymbol, 10),
          constantSymbol: digits(params.constantSymbol, 4),
          specificSymbol: digits(params.specificSymbol, 10),
          paymentNote: text(params.message, 140),
          bankAccounts: [bic ? { iban, bic } : { iban }],
          beneficiary: {
            name: beneficiaryName,
            street: text(params.beneficiaryStreet, 70),
            city: text(params.beneficiaryCity, 70),
          },
        },
      ],
    },
    { deburr: true, validate: true },
  );
}
