/**
 * Swedish identifiers. Offline format and checksum checks only; Bolagsverket
 * and VIES say whether a number actually exists.
 */

const clean = (v: string) => v.replace(/[\s-]+/g, '').toUpperCase();

/** Mod-10 (Luhn) over the whole string, check digit last. */
export function luhnValid(digits: string): boolean {
  if (!/^\d+$/.test(digits)) return false;
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

/**
 * Organisationsnummer (or the personnummer a sole trader uses): 10 digits,
 * Luhn check digit last. A 12-digit form with the century ("16" for legal
 * entities, "19"/"20" for persons) is cut to 10 digits.
 * Source: Skatteverket, SKV 709 "Organisationsnummer".
 */
export function normalizeOrgNr(value: string): string {
  const v = clean(value).replace(/^SE/, '');
  if (/^\d{12}$/.test(v) && /^(16|19|20)/.test(v)) return v.slice(2);
  return v;
}

export function isValidOrgNr(value: string): boolean {
  const v = normalizeOrgNr(value);
  return /^\d{10}$/.test(v) && luhnValid(v);
}

/** Momsregistreringsnummer: "SE" + organisationsnummer/personnummer + "01". */
export function normalizeSeVat(value: string): string {
  const v = clean(value);
  return v.startsWith('SE') ? v : `SE${v}`;
}

export function isValidSeVat(value: string): boolean {
  const m = /^SE(\d{10})01$/.exec(normalizeSeVat(value));
  return m != null && luhnValid(m[1]!);
}

/** Bankgiro (7–8 digits) and PlusGiro (2–8 digits) both end in a Luhn check digit. */
export function isValidBankgiro(value: string): boolean {
  const v = clean(value);
  return /^\d{7,8}$/.test(v) && luhnValid(v);
}

export function isValidPlusgiro(value: string): boolean {
  const v = clean(value);
  return /^\d{2,8}$/.test(v) && luhnValid(v);
}

/**
 * OCR reference for Bankgiro payments: 2–25 digits with a Luhn check digit.
 * Payees with the "variable length + length digit" setting also put the
 * total length (mod 10) in the second-to-last digit; `withLengthDigit`
 * checks that too. Source: Bankgirot, "OCR-referenskontroll" user manual.
 */
export function isValidOcrReference(value: string, withLengthDigit = false): boolean {
  const v = clean(value);
  if (!/^\d{2,25}$/.test(v) || !luhnValid(v)) return false;
  return !withLengthDigit || Number(v[v.length - 2]) === v.length % 10;
}

/** Appends the Luhn check digit (and the length digit when asked) to an invoice number. */
export function makeOcrReference(base: string, withLengthDigit = false): string {
  const b = clean(base);
  if (!/^\d+$/.test(b)) throw new Error('OCR base must be digits');
  const body = withLengthDigit ? `${b}${(b.length + 2) % 10}` : b;
  for (let c = 0; c <= 9; c++) if (luhnValid(`${body}${c}`)) return `${body}${c}`;
  throw new Error('unreachable');
}
