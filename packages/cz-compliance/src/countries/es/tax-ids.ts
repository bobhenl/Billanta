/**
 * Spanish NIF validation, offline (format and check character only).
 *
 * One NIF covers people and entities, in three shapes:
 * - DNI: 8 digits + check letter (mod 23 table);
 * - NIE: X/Y/Z + 7 digits + check letter, X/Y/Z counting as 0/1/2;
 * - entity NIF (the former CIF) and K/L/M personal NIFs: a letter, 7 digits
 *   and a check digit or letter.
 *
 * Source: Orden EHA/451/2008 (composition of the entity NIF) and RD 1065/2007
 * arts. 18–23; the mod 23 table is the one published by the Ministerio del
 * Interior for the DNI.
 */

const DNI_LETTERS = 'TRWAGMYFPDXBNJZSQVHLCKE';
const CONTROL_LETTERS = 'JABCDEFGHI';

export const normalizeEsNif = (value: string): string =>
  value.toUpperCase().replace(/[\s.\-/]/g, '').replace(/^ES/, '');

const dniLetter = (digits: string): string => DNI_LETTERS[Number(digits) % 23]!;

export function isValidDni(value: string): boolean {
  const v = normalizeEsNif(value);
  return /^\d{8}[A-Z]$/.test(v) && dniLetter(v.slice(0, 8)) === v[8];
}

export function isValidNie(value: string): boolean {
  const v = normalizeEsNif(value);
  if (!/^[XYZ]\d{7}[A-Z]$/.test(v)) return false;
  const digits = String('XYZ'.indexOf(v[0]!)) + v.slice(1, 8);
  return dniLetter(digits) === v[8];
}

/** Check digit (0–9) of the 7 central digits of an entity NIF. */
function entityControl(digits: string): number {
  let sum = 0;
  for (let i = 0; i < 7; i++) {
    const d = Number(digits[i]);
    // Positions 1, 3, 5, 7 (index 0, 2, 4, 6) are doubled and their digits summed.
    sum += i % 2 === 0 ? Math.floor((d * 2) / 10) + ((d * 2) % 10) : d;
  }
  return (10 - (sum % 10)) % 10;
}

/**
 * Entity NIF: the first letter is the legal form (Orden EHA/451/2008 art. 3).
 * A, B, E, H always end in a digit; N, P, Q, R, S, W always in a letter;
 * the others accept either.
 */
export function isValidEntityNif(value: string): boolean {
  const v = normalizeEsNif(value);
  const m = /^([ABCDEFGHJNPQRSUVW])(\d{7})([0-9A-J])$/.exec(v);
  if (!m) return false;
  const [, kind, digits, check] = m as unknown as [string, string, string, string];
  const c = entityControl(digits);
  const asDigit = check === String(c);
  const asLetter = check === CONTROL_LETTERS[c];
  if ('ABEH'.includes(kind)) return asDigit;
  if ('NPQRSW'.includes(kind)) return asLetter;
  return asDigit || asLetter;
}

/** K (under 14), L (non-resident Spaniards), M (foreigners without NIE): DNI letter over the 7 digits. */
export function isValidKlmNif(value: string): boolean {
  const v = normalizeEsNif(value);
  return /^[KLM]\d{7}[A-Z]$/.test(v) && dniLetter(v.slice(1, 8)) === v[8];
}

export const isValidEsNif = (value: string): boolean =>
  isValidDni(value) || isValidNie(value) || isValidEntityNif(value) || isValidKlmNif(value);

/** NIF-IVA for intra-EU trade: 'ES' + NIF (ROI registration is checked in VIES, not here). */
export const normalizeEsVatId = (value: string): string => `ES${normalizeEsNif(value)}`;

export const isValidEsVatId = (value: string): boolean => {
  const v = value.toUpperCase().replace(/[\s.\-/]/g, '');
  return v.startsWith('ES') && isValidEsNif(v.slice(2));
};
