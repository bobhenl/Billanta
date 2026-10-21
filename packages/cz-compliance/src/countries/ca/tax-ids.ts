/**
 * Canadian business identifiers.
 *
 * The Business Number (BN) is nine digits, the last a Luhn check digit (the
 * same scheme as the SIN). A program account appends two letters and four
 * digits: RT = GST/HST, RP = payroll, RC = corporate income tax, RM =
 * import/export. GST/HST invoices show the RT account, e.g. 123456782RT0001.
 * https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/registering-your-business/you-need-a-business-number-a-program-account.html
 *
 * The Québec QST number (Revenu Québec) is ten digits + "TQ" + four digits.
 * Its check digit scheme is not published, so only the shape is validated.
 */

/** Strips spaces, dashes and dots and upper-cases program letters. */
export function normalizeCaId(value: string): string {
  return value.replace(/[\s.\-]/g, '').toUpperCase();
}

/** Luhn check over a digit string. */
export function luhnValid(digits: string): boolean {
  if (!/^\d+$/.test(digits)) return false;
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

/** Nine-digit Business Number with a valid check digit. */
export function validateBusinessNumber(value: string): boolean {
  const bn = normalizeCaId(value);
  return /^\d{9}$/.test(bn) && bn !== '000000000' && luhnValid(bn);
}

/**
 * BN plus a program account. `program` limits the two letters, e.g. 'RT'
 * for the GST/HST account that belongs on an invoice.
 */
export function validateProgramAccount(value: string, program?: string): boolean {
  const m = /^(\d{9})([A-Z]{2})(\d{4})$/.exec(normalizeCaId(value));
  if (!m) return false;
  if (program && m[2] !== program) return false;
  return m[3] !== '0000' && validateBusinessNumber(m[1]!);
}

/** Québec QST registration number: 10 digits, 'TQ', 4 digits (shape only). */
export function validateQstNumber(value: string): boolean {
  const m = /^(\d{10})TQ(\d{4})$/.exec(normalizeCaId(value));
  return m != null && m[1] !== '0000000000' && m[2] !== '0000';
}
