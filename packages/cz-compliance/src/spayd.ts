/**
 * SPAYD (Short Payment Descriptor) generator.
 *
 * SPAYD is the Czech Banking Association's standard for encoding a domestic
 * payment as a short text string, which is then rendered as a QR code
 * ("QR Platba") and printed/displayed on invoices so the payer's banking app
 * can scan it and prefill a bank transfer.
 *
 * Spec: "Specifikace formátu QR Platby", Czech Banking Association (ČBA),
 * version 1.0. Reference: https://qr-platba.cz/pro-vyvojare/specifikace-formatu/
 *
 * String shape:
 *   SPD*1.0*ACC:<IBAN>[+<BIC>]*AM:<amount>*CC:<currency>*[X-VS:<variableSymbol>]*[MSG:<message>]*...
 *
 * - Fields are separated by `*`.
 * - Each field is `KEY:VALUE`.
 * - The `SPD*1.0` prefix is mandatory and must be the first two "fields".
 * - `ACC` (IBAN, optionally `+BIC`) is the only mandatory payment field.
 * - Reserved characters within values (`*`, `+`, backslash) must be escaped by
 *   prefixing with a backslash, per the spec's §7 encoding rules.
 */

export interface SpaydParams {
  /** Beneficiary account IBAN, e.g. "CZ6508000000192000145399". Required. */
  iban: string;
  /** Optional BIC/SWIFT code of the beneficiary's bank, appended to ACC as "+BIC". */
  bic?: string;
  /** Payment amount. Formatted with up to 2 decimal places, trailing zeros trimmed per spec convention of using a plain decimal number. */
  amount?: number;
  /** ISO 4217 currency code, e.g. "CZK", "EUR". Defaults to "CZK". */
  currency?: string;
  /** Variable symbol ("variabilní symbol"), digits only, max 10 digits. Encoded as X-VS. */
  variableSymbol?: string;
  /** Constant symbol ("konstantní symbol"), digits only, max 10 digits. Encoded as X-KS. */
  constantSymbol?: string;
  /** Specific symbol ("specifický symbol"), digits only, max 10 digits. Encoded as X-SS. */
  specificSymbol?: string;
  /** Free-text message for the recipient ("zpráva pro příjemce"), max 60 chars per spec. Encoded as MSG. */
  message?: string;
  /** Payment due date. Encoded as DT in YYYYMMDD format. */
  dueDate?: Date;
  /** Recipient's identifier known to the payer's bank, rarely used. Encoded as RN. */
  recipientName?: string;
}

/**
 * Escapes SPAYD reserved characters (`\`, `*`, `+`) in a field value, per the
 * spec's escaping rule: prefix each reserved character with a backslash.
 * Backslash must be escaped first to avoid double-escaping.
 */
function escapeSpaydValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\*/g, '\\*').replace(/\+/g, '\\+');
}

function formatAmount(amount: number): string {
  // SPAYD amounts use '.' as decimal separator and no thousands separator.
  // Round to 2 decimal places but keep integer amounts clean (e.g. "100" not "100.00")
  // is also spec-valid; we always emit 2 decimals for consistency/readability by
  // downstream banking apps, which is explicitly spec-compliant.
  return amount.toFixed(2);
}

function formatDate(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

/**
 * Generates a SPAYD 1.0 payment descriptor string suitable for encoding into
 * a QR code ("QR Platba").
 *
 * @throws {Error} if `iban` is missing/empty.
 */
export function generateSpaydString(params: SpaydParams): string {
  const { iban, bic, amount, currency, variableSymbol, constantSymbol, specificSymbol, message, dueDate, recipientName } =
    params;

  if (!iban || iban.trim().length === 0) {
    throw new Error('generateSpaydString: "iban" is required');
  }

  const fields: string[] = ['SPD', '1.0'];

  // Note: the '+' joining IBAN and BIC is a structural SPAYD separator, not
  // literal data, so it must stay unescaped — each side is escaped
  // independently and then joined, rather than escaping the joined string.
  const normalizedIban = escapeSpaydValue(iban.replace(/\s+/g, '').toUpperCase());
  const accValue = bic ? `${normalizedIban}+${escapeSpaydValue(bic.trim().toUpperCase())}` : normalizedIban;
  fields.push(`ACC:${accValue}`);

  if (amount !== undefined) {
    fields.push(`AM:${formatAmount(amount)}`);
  }

  fields.push(`CC:${(currency ?? 'CZK').toUpperCase()}`);

  if (recipientName) {
    fields.push(`RN:${escapeSpaydValue(recipientName)}`);
  }

  if (dueDate) {
    fields.push(`DT:${formatDate(dueDate)}`);
  }

  if (variableSymbol) {
    fields.push(`X-VS:${escapeSpaydValue(variableSymbol)}`);
  }

  if (constantSymbol) {
    fields.push(`X-KS:${escapeSpaydValue(constantSymbol)}`);
  }

  if (specificSymbol) {
    fields.push(`X-SS:${escapeSpaydValue(specificSymbol)}`);
  }

  if (message) {
    fields.push(`MSG:${escapeSpaydValue(message.slice(0, 60))}`);
  }

  return fields.join('*');
}
