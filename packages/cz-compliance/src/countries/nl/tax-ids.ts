/**
 * Dutch identifiers.
 *
 * Btw-identificatienummer: `NL` + 9 digits + `B` + 2 digits. Two check
 * schemes are in use (Belastingdienst, "Opbouw btw-identificatienummer"):
 * - numbers derived from an RSIN pass the 11-test on the 9 digits
 *   (weights 9..2, the 9th digit is the check digit);
 * - the btw-id issued to sole traders since 1 January 2020 (no longer based
 *   on the BSN) passes ISO 7064 mod 97-10 on the whole string with letters
 *   as numbers (A=10 … Z=35), like an IBAN.
 * A number is valid when either check passes.
 *
 * KvK-nummer: 8 digits. The KvK dropped the check digit, so only the format
 * is validated (Handelsregisterbesluit 2008 art. 20 requires it on invoices).
 */

export function normalizeNlVat(value: string): string {
  const v = value.replace(/[\s.\-]/g, '').toUpperCase();
  return v.startsWith('NL') ? v : `NL${v}`;
}

function elevenTest(nine: string): boolean {
  let sum = 0;
  for (let i = 0; i < 8; i++) sum += Number(nine[i]) * (9 - i);
  sum -= Number(nine[8]);
  return sum % 11 === 0;
}

function mod97(value: string): number {
  const numeric = value.replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  return Number(BigInt(numeric) % 97n);
}

export function validateNlVat(value: string): boolean {
  const v = normalizeNlVat(value);
  const m = /^NL(\d{9})B(\d{2})$/.exec(v);
  if (!m) return false;
  return elevenTest(m[1]!) || mod97(v) === 1;
}

export const normalizeKvk = (value: string): string => value.replace(/[\s.\-]/g, '');

export const validateKvk = (value: string): boolean => /^\d{8}$/.test(normalizeKvk(value));
