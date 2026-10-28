/**
 * Portuguese NIF / NIPC validation, offline (format and mod 11 check digit).
 *
 * Nine digits; the first eight are weighted 9…2, the check digit is
 * 11 − (sum mod 11), with 10 and 11 written as 0. The leading digit(s) give
 * the holder type: 1–3 individuals, 45 non-resident individuals, 5 legal
 * persons, 6 public bodies, 70–79 and 90–91 other entities (estates,
 * condominiums, irregular entities…), 98 non-residents without a permanent
 * establishment, 99 civil companies without legal personality.
 *
 * Source: DL 14/2013 (NIF regime) and AT's published check-digit rule
 * (https://info.portaldasfinancas.gov.pt).
 */

export const normalizePtNif = (value: string): string =>
  value.toUpperCase().replace(/[\s.\-]/g, '').replace(/^PT/, '');

function hasValidCheckDigit(v: string): boolean {
  let sum = 0;
  for (let i = 0; i < 8; i++) sum += Number(v[i]) * (9 - i);
  const check = 11 - (sum % 11);
  return (check >= 10 ? 0 : check) === Number(v[8]);
}

const PREFIX = /^(?:[1235689]|45|7[0-9])/;

export function isValidPtNif(value: string): boolean {
  const v = normalizePtNif(value);
  return /^\d{9}$/.test(v) && PREFIX.test(v) && hasValidCheckDigit(v);
}

/** NIPC: the NIF of a legal person or other entity (first digit 5–9). */
export function isValidPtNipc(value: string): boolean {
  const v = normalizePtNif(value);
  return isValidPtNif(v) && /^[56789]/.test(v);
}

export const normalizePtVatId = (value: string): string => `PT${normalizePtNif(value)}`;

export const isValidPtVatId = (value: string): boolean => {
  const v = value.toUpperCase().replace(/[\s.\-]/g, '');
  return v.startsWith('PT') && isValidPtNif(v.slice(2));
};
