import type { TaxIdSpec } from '../types.js';

/**
 * EIN prefixes the IRS assigns. A prefix outside this list was never issued,
 * so a typo in the first two digits is caught before the invoice goes out.
 * https://www.irs.gov/businesses/small-businesses-self-employed/how-eins-are-assigned-and-valid-ein-prefixes
 */
export const EIN_PREFIXES: ReadonlySet<string> = new Set([
  '01', '02', '03', '04', '05', '06',
  '10', '11', '12', '13', '14', '15', '16',
  '20', '21', '22', '23', '24', '25', '26', '27',
  ...range(30, 48),
  ...range(50, 68),
  '71', '72', '73', '74', '75', '76', '77',
  ...range(80, 88),
  '90', '91', '92', '93', '94', '95', '98', '99',
]);

function range(from: number, to: number): string[] {
  const out: string[] = [];
  for (let i = from; i <= to; i++) out.push(String(i).padStart(2, '0'));
  return out;
}

const digitsOnly = (value: string) => value.replace(/[\s-]/g, '');

export function normalizeEin(value: string): string {
  const d = digitsOnly(value);
  return /^\d{9}$/.test(d) ? `${d.slice(0, 2)}-${d.slice(2)}` : d;
}

/** Shape (NN-NNNNNNN) and an IRS-assigned prefix. The EIN has no check digit. */
export function validateEin(value: string): boolean {
  const d = digitsOnly(value);
  return /^\d{9}$/.test(d) && EIN_PREFIXES.has(d.slice(0, 2)) && d.slice(2) !== '0000000';
}

/**
 * SSN shape after the 2011 randomisation: area not 000, 666 or 9xx, group not
 * 00, serial not 0000. https://www.ssa.gov/employer/randomization.html
 */
export function isSsnShape(value: string): boolean {
  const m = /^(\d{3})(\d{2})(\d{4})$/.exec(digitsOnly(value));
  if (!m) return false;
  const [, area, group, serial] = m;
  return area !== '000' && area !== '666' && !area!.startsWith('9') && group !== '00' && serial !== '0000';
}

/**
 * ITIN shape: starts with 9, middle digits 50–65, 70–88, 90–92 or 94–99.
 * https://www.irs.gov/individuals/individual-taxpayer-identification-number
 */
export function isItinShape(value: string): boolean {
  const m = /^9\d{2}(\d{2})\d{4}$/.exec(digitsOnly(value));
  if (!m) return false;
  const g = Number(m[1]);
  return (g >= 50 && g <= 65) || (g >= 70 && g <= 88) || (g >= 90 && g <= 92) || (g >= 94 && g <= 99);
}

export const EIN_SPEC: TaxIdSpec = {
  kind: 'company',
  label: { en: 'EIN' },
  // The IRS's own placeholder style; 12 is an assigned prefix.
  example: '12-3456789',
  normalize: normalizeEin,
  validate: validateEin,
  // No federal rule, but clients paying a contractor need it for the 1099-NEC
  // and usually ask for it with a Form W-9 rather than on the invoice.
  requiredOnInvoice: false,
  source: {
    title: 'IRS – How EINs are assigned and valid EIN prefixes',
    url: 'https://www.irs.gov/businesses/small-businesses-self-employed/how-eins-are-assigned-and-valid-ein-prefixes',
  },
};

/**
 * A sole proprietor without an EIN reports income under an SSN or ITIN. The
 * check is shape only and the value is personal data: it must never be logged,
 * printed on an invoice by default or stored outside an encrypted field.
 */
export const SSN_ITIN_SPEC: TaxIdSpec = {
  kind: 'tax',
  label: { en: 'SSN / ITIN' },
  // 987-65-432x is the range the SSA reserves for advertising; it passes the ITIN shape.
  example: '987-65-4320',
  normalize: digitsOnly,
  validate: (value) => isSsnShape(value) || isItinShape(value),
  requiredOnInvoice: false,
  source: { title: 'SSA – Social Security Number randomization', url: 'https://www.ssa.gov/employer/randomization.html' },
};
