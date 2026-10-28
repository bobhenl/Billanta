/**
 * Estonian identifiers and the domestic payment reference. Offline format and
 * checksum checks only; the e-Business Register and VIES say whether a
 * number actually exists.
 */
import { reference731CheckDigit } from '../fi/ids.js';

const clean = (v: string) => v.replace(/[\s.-]+/g, '').toUpperCase();

/**
 * Registrikood: 8 digits. Check digit by the same modulus-11 rule as the
 * isikukood: weights 1…7, and when the remainder is 10, weights 3…9; a second
 * 10 gives 0. Source: e-Äriregister / EVS 585:2007.
 */
export function normalizeRegistrikood(value: string): string {
  return clean(value).replace(/^EE/, '');
}

export function isValidRegistrikood(value: string): boolean {
  const v = normalizeRegistrikood(value);
  if (!/^[1-9]\d{7}$/.test(v)) return false;
  const mod = (start: number) => {
    let sum = 0;
    for (let i = 0; i < 7; i++) sum += Number(v[i]) * (((start - 1 + i) % 9) + 1);
    return sum % 11;
  };
  let r = mod(1);
  if (r === 10) r = mod(3);
  if (r === 10) r = 0;
  return r === Number(v[7]);
}

/**
 * KMKR number: "EE" + 9 digits, weights 3 7 1 3 7 1 3 7 1, weighted sum
 * divisible by 10. Source: EMTA / VIES.
 */
export function normalizeEeVat(value: string): string {
  return `EE${clean(value).replace(/^EE/, '')}`;
}

export function isValidEeVat(value: string): boolean {
  const v = normalizeEeVat(value);
  if (!/^EE\d{9}$/.test(v)) return false;
  const weights = [3, 7, 1, 3, 7, 1, 3, 7, 1];
  return weights.reduce((sum, w, i) => sum + w * Number(v[2 + i]), 0) % 10 === 0;
}

/**
 * Viitenumber: 2–20 digits, the last one a 7-3-1 check digit (the Finnish
 * algorithm). Source: Pangaliit, "Viitenumbri standard".
 */
export function isValidEeReference(value: string): boolean {
  const v = clean(value);
  if (!/^\d{2,20}$/.test(v)) return false;
  return reference731CheckDigit(v.slice(0, -1)) === Number(v[v.length - 1]);
}

export function makeEeReference(base: string): string {
  const b = clean(base);
  if (!/^\d{1,19}$/.test(b)) throw new Error('Reference base must be 1–19 digits');
  return `${b}${reference731CheckDigit(b)}`;
}
