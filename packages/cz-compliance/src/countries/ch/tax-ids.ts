import type { TaxIdSpec } from '../types.js';

const VAT_SUFFIX = /(MWST|TVA|IVA|VAT)$/;

const compact = (value: string) => value.replace(/[\s.\-]/g, '').toUpperCase();

/**
 * UID check digit (9th digit): weights 5,4,3,2,7,6,5,4 over the first eight
 * digits, check = 11 − (sum mod 11), 11 → 0; a result of 10 is never issued.
 * Source: BFS, "UID – Aufbau der Nummer" / eCH-0097.
 */
export function uidCheckDigit(eightDigits: string): number | null {
  const weights = [5, 4, 3, 2, 7, 6, 5, 4];
  const sum = eightDigits.split('').reduce((acc, ch, i) => acc + Number(ch) * weights[i]!, 0);
  const check = 11 - (sum % 11);
  if (check === 10) return null;
  return check === 11 ? 0 : check;
}

/** "CHE-123.456.788" form, any separators accepted. */
export function normalizeUid(value: string): string {
  const v = compact(value).replace(VAT_SUFFIX, '');
  const digits = v.startsWith('CHE') ? v.slice(3) : v;
  if (!/^\d{9}$/.test(digits)) return v;
  return `CHE-${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6)}`;
}

export function isValidUid(value: string): boolean {
  const v = compact(value);
  if (!/^CHE\d{9}$/.test(v)) return false;
  return uidCheckDigit(v.slice(3, 11)) === Number(v[11]);
}

/** The MWST number is the UID plus "MWST" / "TVA" / "IVA" (Art. 26 Abs. 2 lit. a MWSTG). */
export function normalizeMwstNumber(value: string): string {
  const suffix = compact(value).match(VAT_SUFFIX)?.[1] ?? 'MWST';
  return `${normalizeUid(value)} ${suffix}`;
}

export function isValidMwstNumber(value: string): boolean {
  return isValidUid(compact(value).replace(VAT_SUFFIX, ''));
}

export const CH_TAX_IDS: readonly TaxIdSpec[] = [
  {
    kind: 'vat',
    label: { de: 'MWST-Nr.', fr: 'No TVA', it: 'N. IVA', en: 'VAT number' },
    // The BFS sample UID; it passes the check digit.
    example: 'CHE-123.456.788 MWST',
    normalize: normalizeMwstNumber,
    validate: isValidMwstNumber,
    requiredOnInvoice: true,
    source: { title: 'Art. 26 MWSTG', url: 'https://www.fedlex.admin.ch/eli/cc/2009/615/de#art_26' },
  },
  {
    kind: 'company',
    label: { de: 'UID', fr: 'IDE', it: 'IDI', en: 'Business ID (UID)' },
    example: 'CHE-123.456.788',
    normalize: normalizeUid,
    validate: isValidUid,
    requiredOnInvoice: false,
    source: { title: 'UID-Register (BFS)', url: 'https://www.uid.admin.ch/' },
  },
];
