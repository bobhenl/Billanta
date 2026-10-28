import { compact } from './hijri.js';

/**
 * UAE Tax Registration Number: 15 digits, in practice starting with "100".
 * The FTA publishes no checksum, so only the shape is checked; the
 * authoritative check is the TRN verification on tax.gov.ae / EmaraTax.
 * The 10-digit TIN used for corporate tax and as the Peppol identifier is
 * the first 10 digits of the TRN.
 */
export const normalizeTrn = (value: string): string => compact(value).replace(/^AE/, '');

export const isValidTrn = (value: string): boolean => /^\d{15}$/.test(value);

/** TIN (first 10 digits) for the PINT AE / Peppol endpoint. */
export const tinFromTrn = (trn: string): string | null => {
  const n = normalizeTrn(trn);
  return isValidTrn(n) ? n.slice(0, 10) : null;
};
