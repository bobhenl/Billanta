/**
 * UK identifiers: the VAT registration number (with the Northern Ireland "XI"
 * prefix), the Companies House company number and the domestic bank account.
 */

/** Strips spaces, dots, dashes and the "GB" / "XI" prefix. */
export function normalizeUkVatNumber(value: string): string {
  return value.toUpperCase().replace(/[\s.-]/g, '').replace(/^(GB|XI)/, '');
}

/**
 * HMRC check: digits 1–7 weighted 8..2 plus the last two digits as a number.
 * Older numbers are valid when the sum is divisible by 97, numbers issued
 * since 2010 when sum + 55 is ("mod 9755"). Branch traders append a 3-digit
 * branch code, which is not part of the check. GD (government departments,
 * 000–499) and HA (health authorities, 500–999) numbers carry no checksum.
 * Same algorithm as python-stdnum `gb.vat`.
 */
export function isValidUkVatNumber(value: string): boolean {
  const v = normalizeUkVatNumber(value);
  const gd = /^GD(\d{3})$/.exec(v);
  if (gd) return Number(gd[1]) < 500;
  const ha = /^HA(\d{3})$/.exec(v);
  if (ha) return Number(ha[1]) >= 500;
  if (!/^(\d{9}|\d{12})$/.test(v)) return false;
  let sum = Number(v.slice(7, 9));
  for (let i = 0; i < 7; i++) sum += Number(v[i]) * (8 - i);
  return sum % 97 === 0 || (sum + 55) % 97 === 0;
}

/** Northern Ireland traders use "XI" for goods (Windsor Framework); the number behind it is the same GB number. */
export const isNorthernIrelandVatNumber = (value: string): boolean => /^\s*XI/i.test(value);

/** Pads purely numeric numbers to 8 digits ("445790" → "00445790"). */
export function normalizeCompanyNumber(value: string): string {
  const v = value.toUpperCase().replace(/[\s.-]/g, '');
  return /^\d{1,7}$/.test(v) ? v.padStart(8, '0') : v;
}

/**
 * 8 characters: 8 digits (England & Wales), or a 2-letter prefix plus 6 digits
 * (SC Scotland, NI Northern Ireland, OC/SO/NC LLPs, LP, FC overseas, IP…).
 * Companies House publishes no checksum, so this is a format check only.
 */
export function isValidCompanyNumber(value: string): boolean {
  return /^(\d{8}|[A-Z]{2}\d{6}|R0\d{6})$/.test(normalizeCompanyNumber(value));
}

/**
 * Sort code (6 digits) followed by an account number (8 digits), separators
 * ignored: "12-34-56 12345678". Format only – Pay.UK modulus checking needs
 * the sort-code weight table and is not implemented.
 */
export function isValidUkBankAccount(value: string): boolean {
  return /^\d{14}$/.test(value.replace(/[\s-]/g, ''));
}
