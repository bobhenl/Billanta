/**
 * Icelandic identifiers: the kennitala (national ID for people and
 * companies), the VSK number (VAT registration) and the domestic bank account.
 */

export const normalizeKennitala = (value: string): string => value.replace(/[\s-]/g, '');

/**
 * DDMMYY + 2 digits + check digit + century digit (9 = 1900s, 0 = 2000s,
 * 8 = 1800s). Companies add 40 to the day. Check digit: weights
 * 3,2,7,6,5,4,3,2, 11 − sum mod 11 (11 → 0, 10 invalid). Same algorithm as
 * python-stdnum `is_.kennitala`.
 */
export function isValidKennitala(value: string): boolean {
  const v = normalizeKennitala(value);
  if (!/^\d{8}\d[089]$/.test(v)) return false;
  const day = Number(v.slice(0, 2)) % 40;
  const month = Number(v.slice(2, 4));
  if (day < 1 || day > 31 || month < 1 || month > 12) return false;
  const weights = [3, 2, 7, 6, 5, 4, 3, 2];
  let sum = 0;
  for (let i = 0; i < 8; i++) sum += Number(v[i]) * weights[i]!;
  const check = (11 - (sum % 11)) % 11;
  return check !== 10 && check === Number(v[8]);
}

/** True for a company kennitala (day + 40). */
export const isCompanyKennitala = (value: string): boolean =>
  isValidKennitala(value) && Number(normalizeKennitala(value).slice(0, 2)) > 40;

export const normalizeVskNumber = (value: string): string => value.toUpperCase().replace(/[\s.-]/g, '').replace(/^IS/, '');

/** VSK numbers are 5 or 6 digit sequence numbers with no published checksum. */
export const isValidVskNumber = (value: string): boolean => /^\d{5,6}$/.test(normalizeVskNumber(value));

/**
 * Domestic account: 4-digit bank/branch, 2-digit ledger (höfuðbók), 6-digit
 * account number, often written "0133-26-012345"; may be followed by the
 * owner's kennitala.
 */
export function isValidIsBankAccount(value: string): boolean {
  const v = value.replace(/[\s-]/g, '');
  if (/^\d{12}$/.test(v)) return true;
  return /^\d{22}$/.test(v) && isValidKennitala(v.slice(12));
}
