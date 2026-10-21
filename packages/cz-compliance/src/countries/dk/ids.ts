/**
 * Danish identifiers. Offline format and checksum checks only; CVR and VIES
 * say whether a number actually exists.
 */
import { luhnValid } from '../se/ids.js';

const clean = (v: string) => v.replace(/[\s.-]+/g, '').toUpperCase();

/**
 * CVR-nummer: 8 digits, first digit not 0, weights 2 7 6 5 4 3 2 1 and the
 * weighted sum divisible by 11. Source: Erhvervsstyrelsen, "Modulus 11-kontrol
 * af CVR-numre".
 */
export function normalizeCvr(value: string): string {
  return clean(value).replace(/^DK/, '');
}

export function isValidCvr(value: string): boolean {
  const v = normalizeCvr(value);
  if (!/^[1-9]\d{7}$/.test(v)) return false;
  const weights = [2, 7, 6, 5, 4, 3, 2, 1];
  return weights.reduce((sum, w, i) => sum + w * Number(v[i]), 0) % 11 === 0;
}

/** Momsnummer (SE-nummer for VAT) is "DK" + the CVR number. */
export function normalizeDkVat(value: string): string {
  return `DK${normalizeCvr(value)}`;
}

export function isValidDkVat(value: string): boolean {
  return isValidCvr(normalizeDkVat(value));
}

/**
 * FI-kort (Fælles Indbetalingskort) line, e.g. "+71<000000000012343+12345678<".
 * Card types 71 (15-digit payment ID) and 75 (16-digit payment ID) carry a
 * mod-10 (Luhn) check digit; type 73 has no payment ID. The creditor number
 * is 8 digits. Source: Mastercard Payment Services, "Indbetalingskort –
 * teknisk vejledning".
 */
export function isValidFik(value: string): boolean {
  const m = /^\+?(71|73|75)<?(\d*)\+?(\d{8})<?$/.exec(value.replace(/\s+/g, ''));
  if (!m) return false;
  const [, type, id, creditor] = m;
  if (!creditor) return false;
  if (type === '73') return id === '';
  const len = type === '71' ? 15 : 16;
  return id!.length === len && luhnValid(id!);
}
