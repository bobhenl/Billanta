/**
 * Finnish identifiers and the domestic payment reference. Offline format and
 * checksum checks only; YTJ and VIES say whether a number actually exists.
 */

const clean = (v: string) => v.replace(/[\s.]+/g, '').toUpperCase();

/**
 * Y-tunnus (business ID): 7 digits, a dash and a check digit. Weights
 * 7 9 10 5 8 4 2, r = sum mod 11; r = 1 is never issued, r = 0 gives 0,
 * otherwise the check digit is 11 − r. Old 6-digit IDs are padded with a
 * leading zero. Source: Verohallinto / YTJ, "Y-tunnuksen tarkistusmerkki".
 */
export function normalizeYTunnus(value: string): string {
  const v = clean(value).replace(/^FI/, '').replace('-', '');
  if (!/^\d{7,8}$/.test(v)) return v;
  const digits = v.padStart(8, '0');
  return `${digits.slice(0, 7)}-${digits[7]}`;
}

export function isValidYTunnus(value: string): boolean {
  const v = normalizeYTunnus(value);
  if (!/^\d{7}-\d$/.test(v)) return false;
  const weights = [7, 9, 10, 5, 8, 4, 2];
  const r = weights.reduce((sum, w, i) => sum + w * Number(v[i]), 0) % 11;
  if (r === 1) return false;
  return (r === 0 ? 0 : 11 - r) === Number(v[8]);
}

/** ALV-numero is "FI" + the Y-tunnus without the dash. */
export function normalizeFiVat(value: string): string {
  return `FI${normalizeYTunnus(value).replace('-', '')}`;
}

export function isValidFiVat(value: string): boolean {
  const v = normalizeFiVat(value);
  return /^FI\d{8}$/.test(v) && isValidYTunnus(v);
}

/**
 * Check digit of the national 7-3-1 reference: weights 7, 3, 1 repeated from
 * the right, check = (10 − sum mod 10) mod 10. Finland (viitenumero) and
 * Estonia (viitenumber) use the same algorithm.
 */
export function reference731CheckDigit(base: string): number {
  const weights = [7, 3, 1];
  let sum = 0;
  for (let i = 0; i < base.length; i++) sum += Number(base[base.length - 1 - i]) * weights[i % 3]!;
  return (10 - (sum % 10)) % 10;
}

/**
 * Viitenumero: 4–20 digits including the check digit (base 3–19 digits).
 * Source: Finanssiala, "Kotimaisen viitteen rakenneohje".
 */
export function isValidFiReference(value: string): boolean {
  const v = clean(value);
  if (!/^\d{4,20}$/.test(v)) return false;
  return reference731CheckDigit(v.slice(0, -1)) === Number(v[v.length - 1]);
}

/** Builds a viitenumero from an invoice number (3–19 digits, leading zeros dropped). */
export function makeFiReference(base: string): string {
  const b = clean(base).replace(/^0+/, '');
  if (!/^\d{3,19}$/.test(b)) throw new Error('Reference base must be 3–19 digits');
  return `${b}${reference731CheckDigit(b)}`;
}
