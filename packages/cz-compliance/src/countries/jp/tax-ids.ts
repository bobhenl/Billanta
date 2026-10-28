/**
 * Japanese corporate number (法人番号): 13 digits, the first is a check digit
 * over the other 12 (Ministerial Ordinance on the Corporate Number, art. 1):
 * check = 9 - (Σ P_n × Q_n mod 9), where P_n is the n-th digit counted from
 * the right of the 12 base digits and Q_n is 1 for odd n, 2 for even n.
 */
export function normalizeJpCorporateNumber(value: string): string {
  return value.replace(/[\s-]/g, '');
}

export function isValidJpCorporateNumber(value: string): boolean {
  const v = normalizeJpCorporateNumber(value);
  if (!/^\d{13}$/.test(v)) return false;
  const base = v.slice(1);
  let sum = 0;
  for (let n = 1; n <= 12; n++) sum += Number(base[12 - n]) * (n % 2 === 1 ? 1 : 2);
  return 9 - (sum % 9) === Number(v[0]);
}

/**
 * Qualified invoice issuer registration number (登録番号): "T" + 13 digits. A
 * corporation's is its corporate number; a sole proprietor gets a new number
 * from the NTA (never the My Number).
 */
export function normalizeJpInvoiceRegistrationNumber(value: string): string {
  return value.replace(/[\s-]/g, '').toUpperCase();
}

export function isValidJpInvoiceRegistrationNumber(value: string): boolean {
  const v = normalizeJpInvoiceRegistrationNumber(value);
  return /^T\d{13}$/.test(v) && isValidJpCorporateNumber(v.slice(1));
}

/**
 * Zengin domestic account: 4-digit bank code, 3-digit branch code, 7-digit
 * account number. The account type (普通 / 当座) is a separate field.
 */
export function isValidJpBankAccount(value: string): boolean {
  return /^\d{14}$/.test(value.replace(/[\s-]/g, ''));
}
