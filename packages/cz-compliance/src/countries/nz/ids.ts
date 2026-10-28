/**
 * New Zealand identifiers.
 *
 * IRD number: 8 or 9 digits (8-digit ones are padded with a leading zero).
 * Weights 3, 2, 7, 6, 5, 4, 3, 2 on the eight base digits, check digit is
 * 11 minus the remainder mod 11 (0 when the remainder is 0). When that gives
 * 10, the secondary weights 7, 4, 3, 2, 5, 2, 7, 6 are used; 10 again means
 * invalid. Valid numbers lie between 10,000,000 and 150,000,000 (IRD RWT/NRWT
 * specification, "IRD number validation"). The GST registration number is the
 * IRD number.
 *
 * NZBN: a 13-digit GS1 Global Location Number (prefix 94) with the GS1 mod-10
 * check digit (https://www.nzbn.govt.nz/).
 */

const IRD_PRIMARY = [3, 2, 7, 6, 5, 4, 3, 2];
const IRD_SECONDARY = [7, 4, 3, 2, 5, 2, 7, 6];

export const normalizeIrd = (value: string): string => value.replace(/[\s-]/g, '').replace(/^NZ/i, '');

function irdCheck(base: string, weights: readonly number[]): number {
  const sum = [...base].reduce((acc, ch, i) => acc + Number(ch) * weights[i]!, 0);
  const r = sum % 11;
  return r === 0 ? 0 : 11 - r;
}

export function isValidIrd(value: string): boolean {
  const n = normalizeIrd(value);
  if (!/^\d{8,9}$/.test(n)) return false;
  const num = Number(n);
  if (num <= 10_000_000 || num >= 150_000_000) return false;
  const base = n.padStart(9, '0').slice(0, 8);
  let check = irdCheck(base, IRD_PRIMARY);
  if (check === 10) check = irdCheck(base, IRD_SECONDARY);
  return check !== 10 && check === Number(n[n.length - 1]);
}

export const formatIrd = (value: string): string => {
  const n = normalizeIrd(value);
  return `${n.slice(0, -6)}-${n.slice(-6, -3)}-${n.slice(-3)}`;
};

export const normalizeNzbn = (value: string): string => value.replace(/\s/g, '');

/** GS1 mod 10: from the right, weights 3, 1, 3, 1 … on the digits before the check digit. */
export function gs1CheckDigit(body: string): number {
  const sum = [...body].reverse().reduce((acc, ch, i) => acc + Number(ch) * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10;
}

export function isValidNzbn(value: string): boolean {
  const n = normalizeNzbn(value);
  return /^94\d{11}$/.test(n) && gs1CheckDigit(n.slice(0, 12)) === Number(n[12]);
}

/**
 * Bank-branch-account-suffix, written 12-3456-7890123-00 (2-4-7-2/3 digits).
 * The banks' modulus rules (Payments NZ) differ per bank and branch range, so
 * this checks the format only.
 */
export function isValidNzBankAccount(value: string): boolean {
  return /^\d{2}[\s-]?\d{4}[\s-]?\d{7}[\s-]?\d{2,3}$/.test(value.trim());
}
