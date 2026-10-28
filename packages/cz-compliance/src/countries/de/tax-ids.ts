import type { TaxIdSpec } from '../types.js';

const compact = (value: string) => value.replace(/[\s.\-/]/g, '').toUpperCase();

/**
 * ISO 7064 MOD 11,10 – the check digit of the German USt-IdNr (9th digit).
 * Source: BZSt, "Aufbau der USt-IdNr." / EU VIES algorithm documentation.
 */
export function mod11_10CheckDigit(digits: string): number {
  let product = 10;
  for (const ch of digits) {
    let sum = (Number(ch) + product) % 10;
    if (sum === 0) sum = 10;
    product = (2 * sum) % 11;
  }
  const check = 11 - product;
  return check === 10 ? 0 : check;
}

export function normalizeUstIdNr(value: string): string {
  const v = compact(value);
  return v.startsWith('DE') ? v : `DE${v}`;
}

/** DE + 9 digits, the first not 0, the last a MOD 11,10 check digit. */
export function isValidUstIdNr(value: string): boolean {
  const v = compact(value);
  if (!/^DE[1-9]\d{8}$/.test(v)) return false;
  return mod11_10CheckDigit(v.slice(2, 10)) === Number(v[10]);
}

export function normalizeSteuernummer(value: string): string {
  return value.replace(/\s/g, '');
}

/**
 * Steuernummer in the Länder format (10 or 11 digits, with or without
 * slashes, e.g. Berlin `21/815/08150`, Bavaria `181/815/08155`) or the
 * 13-digit ELSTER format. The check digit differs per Land and is not
 * checked here (see caveats).
 */
export function isValidSteuernummer(value: string): boolean {
  const v = normalizeSteuernummer(value);
  if (!/^[\d/]+$/.test(v)) return false;
  const digits = v.replace(/\//g, '');
  if (v.includes('/') && !/^\d{2,3}\/\d{3,4}\/\d{4,5}$/.test(v)) return false;
  return digits.length === 10 || digits.length === 11 || digits.length === 13;
}

/** Handelsregister: register type and number, e.g. "HRB 12345" (court name kept separately). */
export function isValidHandelsregister(value: string): boolean {
  return /^(HRA|HRB|GNR|PR|VR|GSR)\s?\d{1,6}(\s?[A-Z]{1,2})?$/.test(value.trim().toUpperCase());
}

export const DE_TAX_IDS: readonly TaxIdSpec[] = [
  {
    kind: 'vat',
    label: { de: 'USt-IdNr.', en: 'VAT ID (USt-IdNr.)' },
    // Widely published sample number that passes the BZSt check (used in VIES and BZSt test docs).
    example: 'DE136695976',
    normalize: normalizeUstIdNr,
    validate: isValidUstIdNr,
    // § 14 Abs. 4 Nr. 2 UStG: Steuernummer *or* USt-IdNr.; required for intra-EU supplies (§ 14a).
    requiredOnInvoice: true,
    source: { title: '§ 27a UStG', url: 'https://www.gesetze-im-internet.de/ustg_1980/__27a.html' },
  },
  {
    kind: 'tax',
    label: { de: 'Steuernummer', en: 'Tax number (Steuernummer)' },
    example: '21/815/08150',
    normalize: normalizeSteuernummer,
    validate: isValidSteuernummer,
    // Only needed when no USt-IdNr. is printed (§ 14 Abs. 4 Nr. 2 UStG).
    requiredOnInvoice: false,
    source: { title: '§ 14 Abs. 4 Nr. 2 UStG', url: 'https://www.gesetze-im-internet.de/ustg_1980/__14.html' },
  },
  {
    kind: 'company',
    label: { de: 'Handelsregisternummer', en: 'Commercial register number' },
    example: 'HRB 12345',
    normalize: (v) => v.trim().toUpperCase().replace(/\s+/g, ' '),
    validate: isValidHandelsregister,
    // Business letters of a GmbH/AG must show it (§ 35a GmbHG, § 80 AktG), sole traders have none.
    requiredOnInvoice: false,
    source: { title: '§ 35a GmbHG', url: 'https://www.gesetze-im-internet.de/gmbhg/__35a.html' },
  },
];
