/**
 * Slovenian davčna številka: 8 digits, the last one a mod-11 check digit over
 * the first seven with weights 8..2. The VAT ID (ID za DDV) is the same
 * number with the `SI` prefix.
 * Source: FURS, "Davčna številka" and the EU VIES algorithm notes
 * (https://www.fu.gov.si/).
 */
export function normalizeSiTaxNumber(value: string): string {
  return value.replace(/[\s.-]/g, '').toUpperCase().replace(/^SI/, '');
}

export function isValidSiTaxNumber(value: string): boolean {
  const v = normalizeSiTaxNumber(value);
  // The first digit is never 0.
  if (!/^[1-9]\d{7}$/.test(v)) return false;
  let sum = 0;
  for (let i = 0; i < 7; i++) sum += Number(v[i]) * (8 - i);
  const check = 11 - (sum % 11);
  // 11 would need a two-digit check; FURS never issues those numbers.
  if (check === 11) return false;
  return (check === 10 ? 0 : check) === Number(v[7]);
}
