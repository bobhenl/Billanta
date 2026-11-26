/**
 * Luxembourg identifiers.
 *
 * Numéro d'identification TVA: `LU` + 8 digits; the last two digits are the
 * first six mod 89 (AED numbering, the check VIES applies).
 *
 * RCS number: the register section letter (B for commercial companies, A for
 * sole traders, …) + up to 6 digits (loi du 19 décembre 2002 art. 26 requires
 * it on invoices and letters). Format only.
 */

export function normalizeLuVat(value: string): string {
  const v = value.replace(/[\s.\-]/g, '').toUpperCase();
  return v.startsWith('LU') ? v : `LU${v}`;
}

export function validateLuVat(value: string): boolean {
  const m = /^LU(\d{6})(\d{2})$/.exec(normalizeLuVat(value));
  return m != null && Number(m[1]) % 89 === Number(m[2]);
}

export const normalizeLuRcs = (value: string): string =>
  value.replace(/[\s.\-]/g, '').toUpperCase().replace(/^RCS(?:LUXEMBOURG)?/, '');

export const validateLuRcs = (value: string): boolean => /^[A-Z]\d{1,6}$/.test(normalizeLuRcs(value));
