import type { TaxIdSpec } from '../types.js';

const compact = (value: string) => value.replace(/[\s.\-/]/g, '').toUpperCase();

export function normalizeUid(value: string): string {
  const v = compact(value);
  if (v.startsWith('ATU')) return v;
  return v.startsWith('U') ? `AT${v}` : `ATU${v}`;
}

/**
 * ATU + 8 digits; the 8th is a check digit over the first seven: odd
 * positions add as they are, even positions add the digit sum of twice the
 * digit, and C8 = (10 − (R + 4) mod 10) mod 10. Source: EU VIES algorithm
 * documentation; BMF AT, "UID-Nummer".
 */
export function isValidUid(value: string): boolean {
  const v = compact(value);
  if (!/^ATU\d{8}$/.test(v)) return false;
  const d = v.slice(3).split('').map(Number);
  let r = 0;
  for (let i = 0; i < 7; i++) {
    if (i % 2 === 0) r += d[i]!;
    else {
      const twice = d[i]! * 2;
      r += Math.floor(twice / 10) + (twice % 10);
    }
  }
  return (10 - ((r + 4) % 10)) % 10 === d[7];
}

/** Steuernummer: 2-digit Finanzamt code + 7 digits, e.g. "12 345/6789". Format only. */
export function isValidAtSteuernummer(value: string): boolean {
  return /^\d{9}$/.test(value.replace(/[\s/-]/g, ''));
}

/** Firmenbuchnummer: "FN" + up to 6 digits + a check letter, e.g. "FN 123456a". Format only. */
export function isValidFirmenbuchnummer(value: string): boolean {
  return /^(FN)?\d{1,6}[a-z]$/i.test(value.replace(/\s/g, ''));
}

export const AT_TAX_IDS: readonly TaxIdSpec[] = [
  {
    kind: 'vat',
    label: { de: 'UID-Nummer', en: 'VAT ID (UID)' },
    // Sample number used in the BMF AT and VIES documentation; it passes the checksum.
    example: 'ATU13585627',
    normalize: normalizeUid,
    validate: isValidUid,
    // § 11 Abs. 1 Z 3 lit. i UStG 1994 (for invoices above EUR 400 gross).
    requiredOnInvoice: true,
    source: { title: '§ 11 UStG 1994', url: 'https://www.ris.bka.gv.at/NormDokument.wxe?Abfrage=Bundesnormen&Gesetzesnummer=10004873&Paragraf=11' },
  },
  {
    kind: 'tax',
    label: { de: 'Steuernummer', en: 'Tax number' },
    example: '12 345/6789',
    normalize: (v) => v.replace(/[\s/-]/g, ''),
    validate: isValidAtSteuernummer,
    requiredOnInvoice: false,
  },
  {
    kind: 'company',
    label: { de: 'Firmenbuchnummer', en: 'Company register number (FN)' },
    example: 'FN 123456a',
    normalize: (v) => v.replace(/\s/g, '').replace(/^fn/i, 'FN').replace(/^(\d)/, 'FN$1'),
    validate: isValidFirmenbuchnummer,
    // § 14 UGB: registered entrepreneurs show FN and court on business documents.
    requiredOnInvoice: false,
    source: { title: '§ 14 UGB', url: 'https://www.ris.bka.gv.at/NormDokument.wxe?Abfrage=Bundesnormen&Gesetzesnummer=10001702&Paragraf=14' },
  },
];
