/**
 * Latvian identifiers. Offline format and checksum checks only; the
 * Enterprise Register and VIES say whether a number actually exists.
 */

const clean = (v: string) => v.replace(/[\s.-]+/g, '').toUpperCase();

/**
 * Reģistrācijas numurs of a legal entity: 11 digits, first digit 4–9,
 * weights 9 1 4 8 3 10 2 5 7 6 1 and the weighted sum ≡ 3 (mod 11).
 * Source: VID / VIES algorithm for LV VAT numbers.
 */
export function normalizeLvRegNr(value: string): string {
  return clean(value).replace(/^LV/, '');
}

export function isValidLvRegNr(value: string): boolean {
  const v = normalizeLvRegNr(value);
  if (!/^[4-9]\d{10}$/.test(v)) return false;
  const weights = [9, 1, 4, 8, 3, 10, 2, 5, 7, 6, 1];
  return weights.reduce((sum, w, i) => sum + w * Number(v[i]), 0) % 11 === 3;
}

/**
 * Personas kods used as the VAT number of a self-employed person. Codes
 * starting with "32" (issued since 2017) carry no checksum; older codes use
 * weights 1 6 3 7 9 10 5 8 4 2 and check = (1101 − sum) mod 11.
 */
export function isValidLvPersonalCode(value: string): boolean {
  const v = clean(value);
  if (!/^\d{11}$/.test(v)) return false;
  if (v.startsWith('32')) return true;
  if (!/^[0-3]/.test(v)) return false;
  const weights = [1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
  const sum = weights.reduce((s, w, i) => s + w * Number(v[i]), 0);
  return ((1101 - sum) % 11) % 10 === Number(v[10]);
}

/** PVN reģistrācijas numurs: "LV" + 11 digits (legal entity or personal code). */
export function normalizeLvVat(value: string): string {
  return `LV${normalizeLvRegNr(value)}`;
}

export function isValidLvVat(value: string): boolean {
  const v = normalizeLvVat(value);
  if (!/^LV\d{11}$/.test(v)) return false;
  const n = v.slice(2);
  return Number(n[0]) > 3 ? isValidLvRegNr(n) : isValidLvPersonalCode(n);
}
