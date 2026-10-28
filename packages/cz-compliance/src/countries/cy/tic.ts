/**
 * Cypriot TIC (Tax Identification Code, ΑΦΤ): 8 digits and a check letter.
 * Digits in odd positions (1st, 3rd…) are mapped through a fixed table, the
 * others count as they are; the sum mod 26 picks the letter (0 = A). The VAT
 * ID is `CY` + TIC. Numbers starting with 12 are not issued.
 * Source: Tax Department, Ministry of Finance (https://www.mof.gov.cy/mof/tax/taxdep.nsf)
 * and the EU VIES algorithm notes.
 */
const ODD_DIGIT = [1, 0, 5, 7, 9, 13, 15, 17, 19, 21] as const;

export function normalizeTic(value: string): string {
  return value.replace(/[\s.-]/g, '').toUpperCase().replace(/^CY/, '');
}

export function isValidTic(value: string): boolean {
  const v = normalizeTic(value);
  if (!/^[0-59]\d{7}[A-Z]$/.test(v) || v.startsWith('12')) return false;
  let sum = 0;
  for (let i = 0; i < 8; i++) {
    const digit = Number(v[i]);
    sum += i % 2 === 0 ? ODD_DIGIT[digit]! : digit;
  }
  return String.fromCharCode(65 + (sum % 26)) === v[8];
}
