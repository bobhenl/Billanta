import { compact } from '../ae/hijri.js';

/**
 * Saudi VAT registration number: 15 digits, first and last digit 3 (ZATCA
 * e-invoicing data dictionary, BR-KSA-39/40). No checksum is published.
 */
export const normalizeSaVat = (value: string): string => compact(value).replace(/^SA/, '');

export const isValidSaVat = (value: string): boolean => /^3\d{13}3$/.test(value);

/**
 * Commercial Registration number (CRN): 10 digits. ZATCA requires it (or
 * another listed seller ID) on a standard tax invoice (BR-KSA-08).
 */
export const normalizeCrn = (value: string): string => compact(value);

export const isValidCrn = (value: string): boolean => /^\d{10}$/.test(value);
