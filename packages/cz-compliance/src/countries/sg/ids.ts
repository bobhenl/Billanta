/**
 * Singapore identifiers.
 *
 * UEN (Unique Entity Number, ACRA / uen.gov.sg) comes in three shapes, each
 * with its own check character:
 *  - businesses (ROB): 8 digits + check letter, e.g. 00192200M;
 *  - local companies (ROC): 4-digit year + 5 digits + check letter, e.g. 197401143C;
 *  - other entities: T/S/R + 2-digit year + 2-letter entity type + 4 digits +
 *    check character, e.g. T01FC6132D.
 * The weights and check tables follow the published UEN check-character
 * scheme (the same facts the python-stdnum `sg.uen` module documents).
 *
 * GST registration number (IRAS): a company's UEN, or for others a number in
 * the form M + 8 characters + check letter (M2-0012345-X). IRAS publishes no
 * checksum for the M-format, so that one is a format check.
 */

const ROB_WEIGHTS = [10, 4, 9, 3, 8, 2, 7, 1];
const ROB_CHECK = 'XMKECAWLJDB';
const ROC_WEIGHTS = [10, 8, 6, 4, 9, 7, 5, 3, 1];
const ROC_CHECK = 'ZKCMDNERGWH';
const OTHER_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWX0123456789';
const OTHER_WEIGHTS = [4, 3, 5, 3, 10, 2, 2, 5, 7];
const ENTITY_TYPES = new Set([
  'CC', 'CD', 'CH', 'CL', 'CM', 'CP', 'CS', 'CX', 'DP', 'FB', 'FC', 'FM', 'FN', 'GA', 'GB', 'GS', 'HS',
  'LL', 'LP', 'MB', 'MC', 'MD', 'MH', 'MM', 'MQ', 'NB', 'NR', 'PA', 'PB', 'PF', 'RF', 'RP', 'SM', 'SS',
  'TC', 'TU', 'VH', 'XL',
]);

export const normalizeUen = (value: string): string => value.replace(/[\s-]/g, '').toUpperCase();

const weighted = (digits: string, weights: readonly number[]): number =>
  [...digits].reduce((acc, ch, i) => acc + Number(ch) * weights[i]!, 0);

function isValidOtherUen(uen: string): boolean {
  if (!/^[RST]\d{2}[A-Z]{2}\d{4}[A-Z0-9]$/.test(uen) || !ENTITY_TYPES.has(uen.slice(3, 5))) return false;
  const sum = [...uen.slice(0, 9)].reduce((acc, ch, i) => acc + OTHER_ALPHABET.indexOf(ch) * OTHER_WEIGHTS[i]!, 0);
  return OTHER_ALPHABET[(((sum - 5) % 11) + 11) % 11] === uen[9];
}

export function isValidUen(value: string): boolean {
  const uen = normalizeUen(value);
  if (/^\d{8}[A-Z]$/.test(uen)) return ROB_CHECK[weighted(uen.slice(0, 8), ROB_WEIGHTS) % 11] === uen[8];
  if (/^\d{9}[A-Z]$/.test(uen)) {
    const year = Number(uen.slice(0, 4));
    if (year < 1800 || year > new Date().getUTCFullYear()) return false;
    return ROC_CHECK[weighted(uen.slice(0, 9), ROC_WEIGHTS) % 11] === uen[9];
  }
  return isValidOtherUen(uen);
}

export const normalizeGstNo = (value: string): string => normalizeUen(value);

export function isValidGstNo(value: string): boolean {
  const n = normalizeGstNo(value);
  return /^M[0-9A-Z]\d{7}[A-Z]$/.test(n) || isValidUen(n);
}
