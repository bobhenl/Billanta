/**
 * Norwegian identifiers: the organisasjonsnummer (also the base of the VAT
 * number, "NO 923 609 016 MVA") and the 11-digit domestic bank account.
 */

/** mod 11 check digit with the given weights; null when the remainder gives 10 (invalid). */
function mod11(digits: string, weights: readonly number[]): number | null {
  let sum = 0;
  for (let i = 0; i < weights.length; i++) sum += Number(digits[i]) * weights[i]!;
  const check = 11 - (sum % 11);
  if (check === 11) return 0;
  return check === 10 ? null : check;
}

/** Strips spaces, dots, dashes, the "NO" prefix and the "MVA" suffix. */
export function normalizeOrgNumber(value: string): string {
  return value.toUpperCase().replace(/[\s.-]/g, '').replace(/^NO/, '').replace(/MVA$/, '');
}

/**
 * 9 digits starting with 8 or 9, weights 3,2,7,6,5,4,3,2 mod 11
 * (Brønnøysundregistrene; same algorithm as python-stdnum `no.orgnr`).
 */
export function isValidOrgNumber(value: string): boolean {
  const v = normalizeOrgNumber(value);
  if (!/^[89]\d{8}$/.test(v)) return false;
  return mod11(v, [3, 2, 7, 6, 5, 4, 3, 2]) === Number(v[8]);
}

/** Formats as the VAT number printed on invoices: "NO 923 609 016 MVA". */
export function formatNoVatNumber(value: string): string {
  const v = normalizeOrgNumber(value);
  return `NO ${v.slice(0, 3)} ${v.slice(3, 6)} ${v.slice(6)} MVA`;
}

/**
 * Domestic account "XXXX XX XXXXX": 4-digit bank, 2-digit account type,
 * 4 digits + check digit, mod 11 with weights 5,4,3,2,7,6,5,4,3,2.
 */
export function isValidNoBankAccount(value: string): boolean {
  const v = value.replace(/[\s.-]/g, '');
  if (!/^\d{11}$/.test(v)) return false;
  return mod11(v, [5, 4, 3, 2, 7, 6, 5, 4, 3, 2]) === Number(v[10]);
}
