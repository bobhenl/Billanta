/**
 * Belgian enterprise number (ondernemingsnummer / numéro d'entreprise, KBO/BCE):
 * 10 digits starting with 0 or 1, the last two are 97 − (first eight mod 97)
 * (Wetboek van economisch recht art. III.17; KBO numbering rules). The VAT
 * number is `BE` + the same 10 digits (Royal Decree no. 1 art. 5 §1, 4°).
 */

export function normalizeBeEnterprise(value: string): string {
  let v = value.replace(/[\s.\-]/g, '').toUpperCase();
  if (v.startsWith('BE')) v = v.slice(2);
  // Old 9-digit numbers got a leading 0 when the KBO started in 2003.
  if (/^\d{9}$/.test(v)) v = `0${v}`;
  return v;
}

export function validateBeEnterprise(value: string): boolean {
  const v = normalizeBeEnterprise(value);
  if (!/^[01]\d{9}$/.test(v)) return false;
  const check = 97 - (Number(v.slice(0, 8)) % 97);
  return check === Number(v.slice(8));
}

export const normalizeBeVat = (value: string): string => `BE${normalizeBeEnterprise(value)}`;

export function validateBeVat(value: string): boolean {
  const v = value.replace(/[\s.\-]/g, '').toUpperCase();
  return /^(BE)?[01]?\d{9}$/.test(v) && validateBeEnterprise(v);
}

/** `0202.239.951` – the way the KBO and invoices print it. */
export function formatBeEnterprise(value: string): string {
  const v = normalizeBeEnterprise(value);
  return `${v.slice(0, 4)}.${v.slice(4, 7)}.${v.slice(7)}`;
}
