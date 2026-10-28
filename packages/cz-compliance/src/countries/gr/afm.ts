/**
 * Greek ΑΦΜ (Αριθμός Φορολογικού Μητρώου): 9 digits; the first eight weighted
 * by 2^8..2^1, the sum mod 11 mod 10 is the last digit. The VAT ID is `EL` +
 * ΑΦΜ (Greece uses EL, not GR, in VIES).
 * Source: AADE, Μητρώο και Επικοινωνία (https://www.aade.gr/) and the EU VIES
 * algorithm notes.
 */
export function normalizeAfm(value: string): string {
  return value.replace(/[\s.-]/g, '').toUpperCase().replace(/^(EL|GR)/, '');
}

export function isValidAfm(value: string): boolean {
  const v = normalizeAfm(value);
  if (!/^\d{9}$/.test(v) || v === '000000000') return false;
  let sum = 0;
  for (let i = 0; i < 8; i++) sum += Number(v[i]) * 2 ** (8 - i);
  return (sum % 11) % 10 === Number(v[8]);
}
