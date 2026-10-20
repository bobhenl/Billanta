/**
 * Format and checksum checks of CZ/SK business identifiers, for the public
 * invoice checker and the ISDOC viewer. Offline only: a valid checksum says
 * the number can exist, not that it does (ARES, RPO and VIES answer that).
 */

const digitsOnly = (v: string) => v.replace(/\s+/g, '');

/**
 * IČO (CZ) / IČO (SK): 8 digits, the last one a weighted mod-11 check digit
 * (weights 8…2). Shorter old numbers are left-padded with zeros, as ARES
 * and RPO print them.
 */
export function isValidIco(value: string): boolean {
  const v = digitsOnly(value);
  if (!/^\d{1,8}$/.test(v)) return false;
  const d = v.padStart(8, '0');
  let sum = 0;
  for (let i = 0; i < 7; i++) sum += Number(d[i]) * (8 - i);
  const check = (11 - (sum % 11)) % 10;
  return check === Number(d[7]);
}

/** Rodné číslo as used in a Czech DIČ of a person: 10 digits divisible by 11 (pre-1985 exception: remainder 10 and a final 0). */
function isValidBirthNumber(d: string): boolean {
  if (!/^\d{10}$/.test(d)) return false;
  const n = BigInt(d);
  if (n % 11n === 0n) return true;
  return BigInt(d.slice(0, 9)) % 11n === 10n && d[9] === '0';
}

export type TaxIdKind = 'cz_dic' | 'sk_dic' | 'sk_ic_dph' | 'eu_vat';

export interface TaxIdCheck {
  kind: TaxIdKind;
  valid: boolean;
}

/**
 * Checks a DIČ / IČ DPH / foreign EU VAT ID:
 * - `CZ` + 8 digits (a company: the IČO, same checksum), 9 digits (special
 *   cases, format only) or 10 digits (a person: the rodné číslo, mod 11);
 * - `SK` + 10 digits: the Slovak IČ DPH, divisible by 11, the third digit
 *   2, 3, 4, 7, 8 or 9 (Finančná správa's numbering, also used by VIES);
 * - 10 digits without a prefix: the Slovak DIČ of a non-payer, format only;
 * - another EU prefix: format only (2 letters + 2–12 characters).
 * Returns null for an empty value.
 */
export function checkTaxId(value: string): TaxIdCheck | null {
  const v = digitsOnly(value).toUpperCase();
  if (!v) return null;
  if (v.startsWith('CZ')) {
    const d = v.slice(2);
    if (/^\d{8}$/.test(d)) return { kind: 'cz_dic', valid: isValidIco(d) };
    if (/^\d{9}$/.test(d)) return { kind: 'cz_dic', valid: true };
    if (/^\d{10}$/.test(d)) return { kind: 'cz_dic', valid: isValidBirthNumber(d) };
    return { kind: 'cz_dic', valid: false };
  }
  if (v.startsWith('SK')) {
    const d = v.slice(2);
    const valid = /^\d{10}$/.test(d) && d[0] !== '0' && '234789'.includes(d[2]!) && BigInt(d) % 11n === 0n;
    return { kind: 'sk_ic_dph', valid };
  }
  if (/^\d+$/.test(v)) return { kind: 'sk_dic', valid: /^\d{10}$/.test(v) };
  return { kind: 'eu_vat', valid: /^[A-Z]{2}[0-9A-Z+*]{2,12}$/.test(v) };
}
