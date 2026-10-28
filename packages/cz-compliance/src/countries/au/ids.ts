/**
 * Australian business identifiers and the BSB + account format.
 *
 * ABN: 11 digits. Subtract 1 from the first digit, weight the digits
 * 10, 1, 3, 5 … 19, and the sum must be divisible by 89
 * (https://abr.business.gov.au/Help/AbnFormat).
 * ACN: 9 digits, weights 8 … 1 on the first eight, check digit is the
 * complement of the sum mod 10 (ASIC, Corporations Regulations 2001 reg 1.1.02).
 */

const digitsOnly = (value: string): string => value.replace(/[\s-]/g, '');

export const normalizeAbn = (value: string): string => digitsOnly(value).replace(/^AU/i, '');

export function isValidAbn(value: string): boolean {
  const abn = normalizeAbn(value);
  if (!/^\d{11}$/.test(abn) || abn[0] === '0') return false;
  const weights = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19];
  const sum = [...abn].reduce((acc, ch, i) => acc + (Number(ch) - (i === 0 ? 1 : 0)) * weights[i]!, 0);
  return sum % 89 === 0;
}

export const normalizeAcn = (value: string): string => digitsOnly(value);

export function isValidAcn(value: string): boolean {
  const acn = normalizeAcn(value);
  if (!/^\d{9}$/.test(acn)) return false;
  const sum = [...acn.slice(0, 8)].reduce((acc, ch, i) => acc + Number(ch) * (8 - i), 0);
  return (10 - (sum % 10)) % 10 === Number(acn[8]);
}

/** An ACN-based ABN is the ACN with two ABN check digits in front. */
export function abnFromAcn(acn: string): string | null {
  const n = normalizeAcn(acn);
  if (!isValidAcn(n)) return null;
  for (let p = 10; p <= 99; p++) if (isValidAbn(`${p}${n}`)) return `${p}${n}`;
  return null;
}

export const formatAbn = (value: string): string =>
  normalizeAbn(value).replace(/^(\d{2})(\d{3})(\d{3})(\d{3})$/, '$1 $2 $3 $4');

/**
 * BSB (6 digits, written 062-000) plus an account number of up to 9 digits
 * (APCA BSB directory). Banks use 5–9 digit account numbers and none publishes a
 * shared checksum, so this is a format check. Accepts "062-000 12345678",
 * "062000/12345678" or the digits run together.
 */
export function isValidBsbAccount(value: string): boolean {
  return /^\d{3}-?\d{3}[\s/-]*\d{5,9}$/.test(value.trim());
}
