/**
 * French business identifiers. SIREN (9 digits) and SIRET (SIREN + 5-digit
 * establishment number) carry a Luhn check digit (INSEE, décret n° 73-314
 * and the Sirene register rules). The intra-EU VAT number is derived from
 * the SIREN: `FR` + 2-character key + SIREN, with the numeric key
 * (12 + 3 × (SIREN mod 97)) mod 97 (CGI ann. IV art. 286 ter-0 A; the key
 * formula is the one VIES and the DGFiP publish).
 */

/** La Poste's SIREN; its establishments use a digit-sum mod 5 check instead of Luhn. */
const LA_POSTE_SIREN = '356000000';

export function luhnValid(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let n = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
  }
  return sum % 10 === 0;
}

export const normalizeFrDigits = (value: string): string => value.replace(/[\s.\-]/g, '');

export function validateSiren(value: string): boolean {
  const v = normalizeFrDigits(value);
  return /^\d{9}$/.test(v) && luhnValid(v);
}

export function validateSiret(value: string): boolean {
  const v = normalizeFrDigits(value);
  if (!/^\d{14}$/.test(v)) return false;
  if (v.startsWith(LA_POSTE_SIREN)) {
    // The head office (35600000000048) passes Luhn; other La Poste
    // establishments only satisfy the digit-sum-mod-5 rule.
    const sum = [...v].reduce((s, d) => s + Number(d), 0);
    return sum % 5 === 0 || luhnValid(v);
  }
  return validateSiren(v.slice(0, 9)) && luhnValid(v);
}

/** Numeric VAT key for a SIREN. */
export function frVatKey(siren: string): string {
  const key = (12 + 3 * (Number(siren) % 97)) % 97;
  return String(key).padStart(2, '0');
}

/** `FR` + key + SIREN for a valid SIREN, otherwise null. */
export function frVatFromSiren(siren: string): string | null {
  const s = normalizeFrDigits(siren);
  return validateSiren(s) ? `FR${frVatKey(s)}${s}` : null;
}

export function normalizeFrVat(value: string): string {
  const v = value.replace(/[\s.\-]/g, '').toUpperCase();
  return v.startsWith('FR') ? v : `FR${v}`;
}

/**
 * Some older numbers have an alphanumeric key (letters except I and O) whose
 * algorithm is not public; those are checked for format only.
 */
export function validateFrVat(value: string): boolean {
  const m = /^FR([0-9A-HJ-NP-Z]{2})(\d{9})$/.exec(normalizeFrVat(value));
  if (!m) return false;
  const [, key, siren] = m as unknown as [string, string, string];
  if (/^\d{2}$/.test(key)) return frVatKey(siren) === key;
  return true;
}
