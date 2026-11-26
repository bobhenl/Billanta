import type { TaxIdSpec } from '../types.js';

const digitsOnly = (value: string) => value.replace(/[\s-]/g, '');

/** Weighted mod-11 check digit; `null` when the remainder is 10 and the number can never be valid. */
function mod11(digits: string, weights: readonly number[], tenAsZero: boolean): number | null {
  let sum = 0;
  for (let i = 0; i < weights.length; i++) sum += Number(digits[i]) * weights[i]!;
  const r = sum % 11;
  if (r === 10) return tenAsZero ? 0 : null;
  return r;
}

/** Strips spaces, dashes and the `PL` VAT prefix (`PL526-025-09-95` → `5260250995`). */
export function normalizeNip(value: string): string {
  return digitsOnly(value.trim().toUpperCase()).replace(/^PL/, '');
}

/**
 * NIP: 10 digits, weights 6,5,7,2,3,4,5,6,7, the sum mod 11 is the last digit
 * and a remainder of 10 is never issued. Source: rozporządzenie Ministra
 * Finansów z 1 września 1995 r. w sprawie szczegółowych zasad nadawania NIP
 * (Dz.U. 1995 nr 104 poz. 517), § 3.
 */
export function isValidNip(value: string): boolean {
  const nip = normalizeNip(value);
  if (!/^\d{10}$/.test(nip) || nip === '0000000000') return false;
  const check = mod11(nip, [6, 5, 7, 2, 3, 4, 5, 6, 7], false);
  return check !== null && check === Number(nip[9]);
}

export function normalizeRegon(value: string): string {
  return digitsOnly(value.trim());
}

/**
 * REGON: 9 digits (weights 8,9,2,3,4,5,6,7) or 14 digits for a local unit
 * (weights 2,4,8,5,0,9,7,3,6,1,2,4,8; the first 9 digits are the parent
 * entity's REGON). A remainder of 10 counts as 0. Source: rozporządzenie Rady
 * Ministrów z 30 listopada 2015 r. w sprawie sposobu i metodologii
 * prowadzenia i aktualizacji krajowego rejestru urzędowego podmiotów
 * gospodarki narodowej (Dz.U. 2015 poz. 2009), załącznik nr 2.
 */
export function isValidRegon(value: string): boolean {
  const regon = normalizeRegon(value);
  if (/^\d{9}$/.test(regon)) {
    return mod11(regon, [8, 9, 2, 3, 4, 5, 6, 7], true) === Number(regon[8]);
  }
  if (/^\d{14}$/.test(regon)) {
    return (
      isValidRegon(regon.slice(0, 9)) &&
      mod11(regon, [2, 4, 8, 5, 0, 9, 7, 3, 6, 1, 2, 4, 8], true) === Number(regon[13])
    );
  }
  return false;
}

export const PL_TAX_IDS: readonly TaxIdSpec[] = [
  {
    kind: 'vat',
    label: { pl: 'NIP', en: 'NIP (tax ID)' },
    // NIP of the Ministry of Finance, published on gov.pl.
    example: '526-025-09-95',
    normalize: normalizeNip,
    validate: isValidNip,
    // Art. 106e ust. 1 pkt 4 ustawy o VAT: the seller's NIP is mandatory;
    // pkt 5: the buyer's NIP when the buyer is a taxpayer.
    requiredOnInvoice: true,
    source: {
      title: 'Ustawa o VAT, art. 106e ust. 1 pkt 4–5',
      url: 'https://isap.sejm.gov.pl/isap.nsf/DocDetails.xsp?id=WDU20040540535',
    },
  },
  {
    kind: 'company',
    label: { pl: 'REGON', en: 'REGON (statistical number)' },
    // REGON of the Ministry of Finance.
    example: '000002217',
    normalize: normalizeRegon,
    validate: isValidRegon,
    // Not an invoice field under art. 106e; printed only voluntarily.
    requiredOnInvoice: false,
    source: { title: 'GUS – wyszukiwarka REGON', url: 'https://wyszukiwarkaregon.stat.gov.pl/' },
  },
];
