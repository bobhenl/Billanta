/**
 * Lithuanian identifiers. Offline format and checksum checks only; Registrų
 * centras and VIES say whether a number actually exists.
 */

const clean = (v: string) => v.replace(/[\s.-]+/g, '').toUpperCase();

/**
 * Modulus-11 check shared by the įmonės kodas and the PVM code: weights
 * 1 + (i mod 9), and when the remainder is 10, weights 1 + ((i + 2) mod 9);
 * a second 10 gives 0. Source: VMI / VIES algorithm for LT VAT numbers.
 */
function ltCheckDigit(body: string): number {
  const mod = (shift: number) => {
    let sum = 0;
    for (let i = 0; i < body.length; i++) sum += Number(body[i]) * (1 + ((i + shift) % 9));
    return sum % 11;
  };
  let r = mod(0);
  if (r === 10) r = mod(2);
  return r === 10 ? 0 : r;
}

/** Įmonės kodas: 9 digits with a modulus-11 check digit. */
export function normalizeLtCompanyCode(value: string): string {
  return clean(value);
}

export function isValidLtCompanyCode(value: string): boolean {
  const v = normalizeLtCompanyCode(value);
  return /^\d{9}$/.test(v) && ltCheckDigit(v.slice(0, 8)) === Number(v[8]);
}

/**
 * PVM mokėtojo kodas: "LT" + 9 digits (legal entities, the 8th digit is 1) or
 * 12 digits (temporarily registered and natural persons, the 11th digit is 1).
 */
export function normalizeLtVat(value: string): string {
  return `LT${clean(value).replace(/^LT/, '')}`;
}

export function isValidLtVat(value: string): boolean {
  const v = normalizeLtVat(value);
  const m = /^LT(\d{9}|\d{12})$/.exec(v);
  if (!m) return false;
  const n = m[1]!;
  if (n[n.length - 2] !== '1') return false;
  return ltCheckDigit(n.slice(0, -1)) === Number(n[n.length - 1]);
}
