/**
 * Irish identifiers: the VAT number (shares its algorithm with the PPSN /
 * tax reference number) and the CRO company number.
 */

const CHECK_LETTERS = 'WABCDEFGHIJKLMNOPQRSTUV';

/** Strips spaces, dots, dashes and the "IE" prefix. */
export function normalizeIeVatNumber(value: string): string {
  return value.toUpperCase().replace(/[\s.-]/g, '').replace(/^IE/, '');
}

/**
 * Three formats:
 * - 7 digits + check letter ("6433435F");
 * - 7 digits + check letter + a second letter A–I or W, issued since 2013
 *   ("3628739UA"); the second letter counts in the check with weight 9;
 * - the old format: digit, letter/"+"/"*", 5 digits, check letter
 *   ("8Z49289F"), checked as "0" + digits 3–7 + digit 1.
 * Digits are weighted 8..2 and the sum mod 23 picks the check letter
 * (0 = W, 1 = A … 22 = V). Same algorithm as python-stdnum `ie.vat`.
 */
export function isValidIeVatNumber(value: string): boolean {
  let v = normalizeIeVatNumber(value);
  if (/^\d[A-Z+*]\d{5}[A-W]$/.test(v)) v = `0${v.slice(2, 7)}${v[0]}${v[7]}`;
  if (!/^\d{7}[A-W][A-IW]?$/.test(v)) return false;
  let sum = 0;
  for (let i = 0; i < 7; i++) sum += Number(v[i]) * (8 - i);
  if (v.length === 9) sum += CHECK_LETTERS.indexOf(v[8]!) * 9;
  return CHECK_LETTERS[sum % 23] === v[7];
}

export const normalizeCroNumber = (value: string): string => value.replace(/[\s.-]/g, '').replace(/^0+(?=\d)/, '');

/** CRO company numbers are plain sequence numbers (up to 6 digits today) with no checksum. */
export const isValidCroNumber = (value: string): boolean => /^[1-9]\d{0,6}$/.test(normalizeCroNumber(value));
