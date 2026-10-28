/**
 * Bulgarian identifiers.
 *
 * ЕИК / код по БУЛСТАТ (Закон за търговския регистър и регистъра на ЮЛНЦ,
 * Наредба № 1/2007 на Агенцията по вписванията): 9 digits for a legal entity,
 * 13 for a branch / division (the 9 + 4 more). Check digits:
 * - 9th: digits 1–8 weighted 1..8, mod 11; on 10, weights 3..10, mod 11; 10 → 0.
 * - 13th: digits 9–12 weighted 2,7,3,5, mod 11; on 10, weights 4,9,5,7; 10 → 0.
 *
 * ИН по ДДС (чл. 94, ал. 2 ЗДДС): `BG` + the ЕИК (9 digits) for entities, or
 * `BG` + ЕГН / ЛНЧ (10 digits) for registered individuals. The ЕГН check digit
 * uses weights 2,4,8,5,10,9,7,3,6, mod 11, 10 → 0; the ЛНЧ weights
 * 21,19,17,13,11,9,7,3,1, mod 10.
 */

const digitsAt = (value: string, from: number, weights: readonly number[]): number =>
  weights.reduce((acc, w, i) => acc + w * Number(value[from + i]), 0);

function mod11Check(value: string, from: number, first: readonly number[], second: readonly number[]): number {
  const r = digitsAt(value, from, first) % 11;
  if (r !== 10) return r;
  return (digitsAt(value, from, second) % 11) % 10;
}

export function isValidEik(value: string): boolean {
  if (!/^(\d{9}|\d{13})$/.test(value)) return false;
  if (mod11Check(value, 0, [1, 2, 3, 4, 5, 6, 7, 8], [3, 4, 5, 6, 7, 8, 9, 10]) !== Number(value[8])) return false;
  if (value.length === 9) return true;
  return mod11Check(value, 8, [2, 7, 3, 5], [4, 9, 5, 7]) === Number(value[12]);
}

export const normalizeEik = (value: string): string => value.replace(/[\s.-]/g, '').toUpperCase().replace(/^BG/, '');

export function isValidEgn(value: string): boolean {
  if (!/^\d{10}$/.test(value)) return false;
  const check = (digitsAt(value, 0, [2, 4, 8, 5, 10, 9, 7, 3, 6]) % 11) % 10;
  if (check !== Number(value[9])) return false;
  // Month carries the century: +20 for 1800s, +40 for 2000s.
  let month = Number(value.slice(2, 4));
  let year = 1900 + Number(value.slice(0, 2));
  if (month > 40) {
    month -= 40;
    year += 100;
  } else if (month > 20) {
    month -= 20;
    year -= 100;
  }
  const day = Number(value.slice(4, 6));
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
}

export function isValidLnch(value: string): boolean {
  if (!/^\d{10}$/.test(value)) return false;
  return digitsAt(value, 0, [21, 19, 17, 13, 11, 9, 7, 3, 1]) % 10 === Number(value[9]);
}

export const normalizeBgVatId = (value: string): string => {
  const v = value.replace(/[\s.-]/g, '').toUpperCase();
  return v.startsWith('BG') ? v : `BG${v}`;
};

export function isValidBgVatId(value: string): boolean {
  const m = /^BG(\d{9,10})$/.exec(value);
  if (!m) return false;
  const n = m[1]!;
  return n.length === 9 ? isValidEik(n) : isValidEgn(n) || isValidLnch(n);
}
