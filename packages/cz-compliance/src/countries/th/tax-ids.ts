/**
 * Thai 13-digit tax identification number (เลขประจำตัวผู้เสียภาษีอากร). Since
 * 2013 a juristic person's tax ID is its DBD registration number and an
 * individual's is the national ID number; both use the same check digit:
 * weights 13..2 over the first 12 digits, check = (11 - sum mod 11) mod 10.
 */
export function normalizeThTaxId(value: string): string {
  return value.replace(/[\s-]/g, '');
}

export function isValidThTaxId(value: string): boolean {
  const v = normalizeThTaxId(value);
  if (!/^\d{13}$/.test(v)) return false;
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(v[i]) * (13 - i);
  return (11 - (sum % 11)) % 10 === Number(v[12]);
}

/**
 * Domestic account numbers are 10 digits at most banks; GSB and BAAC use 12.
 * There is no public check-digit scheme, so this checks the shape only.
 */
export function isValidThBankAccount(value: string): boolean {
  return /^(\d{10}|\d{12})$/.test(value.replace(/[\s-]/g, ''));
}
