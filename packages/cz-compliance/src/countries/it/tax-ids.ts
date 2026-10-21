/**
 * Italian tax identifiers, format and check character only (no lookup – there
 * is no free registry API; VIES covers VAT-registered businesses).
 *
 * - Partita IVA: 11 digits = 7-digit taxpayer number, 3-digit provincial
 *   office code, 1 Luhn check digit (DM 23 December 1976, art. 35 DPR 633/1972).
 * - Codice fiscale of a natural person: 16 characters derived from surname,
 *   name, birth date and sex, place of birth, and a check letter (DM 23
 *   December 1976). When two people get the same code the Agenzia replaces
 *   digits from the right with letters (omocodia), so the digit positions
 *   also accept L–V. Companies use an 11-digit codice fiscale built like a
 *   Partita IVA.
 */

export function normalizeItVat(value: string): string {
  return value.replace(/[\s.-]/g, '').toUpperCase().replace(/^IT/, '');
}

// Office codes in use: 001–100 provincial offices, 120/121 (foreign
// entities via the Pescara/Rome central office), 888 and 999 (special cases).
function validOfficeCode(code: number): boolean {
  return (code >= 1 && code <= 100) || code === 120 || code === 121 || code === 888 || code === 999;
}

/** Partita IVA (also the codice fiscale of a company). */
export function isValidItPartitaIva(value: string): boolean {
  if (!/^\d{11}$/.test(value)) return false;
  if (!validOfficeCode(Number(value.slice(7, 10)))) return false;
  let sum = 0;
  for (let i = 0; i < 11; i++) {
    let d = Number(value[i]);
    // Luhn: every second digit (1-based even positions) is doubled.
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

export function normalizeItCodiceFiscale(value: string): string {
  return value.replace(/[\s.-]/g, '').toUpperCase();
}

// Values of the characters in odd (1-based) positions; even positions use
// 0–9 for digits and 0–25 for A–Z.
const ODD: Record<string, number> = {
  0: 1, 1: 0, 2: 5, 3: 7, 4: 9, 5: 13, 6: 15, 7: 17, 8: 19, 9: 21,
  A: 1, B: 0, C: 5, D: 7, E: 9, F: 13, G: 15, H: 17, I: 19, J: 21, K: 2, L: 4, M: 18,
  N: 20, O: 11, P: 3, Q: 6, R: 8, S: 12, T: 14, U: 16, V: 10, W: 22, X: 25, Y: 24, Z: 23,
};

function evenValue(ch: string): number {
  return /\d/.test(ch) ? Number(ch) : ch.charCodeAt(0) - 65;
}

/** The check letter for the first 15 characters of a personal codice fiscale. */
export function itCodiceFiscaleCheckChar(first15: string): string {
  let sum = 0;
  for (let i = 0; i < 15; i++) {
    const ch = first15[i]!;
    sum += i % 2 === 0 ? ODD[ch]! : evenValue(ch);
  }
  return String.fromCharCode(65 + (sum % 26));
}

/** Omocodia letters stand for the digits 0–9. */
const OMOCODIA = 'LMNPQRSTUV';
const MONTHS = 'ABCDEHLMPRST';
const PERSONAL = /^[A-Z]{6}[\dLMNPQRSTUV]{2}[ABCDEHLMPRST][\dLMNPQRSTUV]{2}[A-Z][\dLMNPQRSTUV]{3}[A-Z]$/;

function decodeDigits(s: string): number {
  return Number([...s].map((c) => (/\d/.test(c) ? c : String(OMOCODIA.indexOf(c)))).join(''));
}

/** Personal (16-character) codice fiscale, with omocodia. */
export function isValidItPersonalCodiceFiscale(value: string): boolean {
  if (!PERSONAL.test(value)) return false;
  if (MONTHS.indexOf(value[8]!) < 0) return false;
  // Women have 40 added to the day of birth.
  const day = decodeDigits(value.slice(9, 11));
  if (!((day >= 1 && day <= 31) || (day >= 41 && day <= 71))) return false;
  return itCodiceFiscaleCheckChar(value.slice(0, 15)) === value[15];
}

/** Codice fiscale of a person (16 chars) or a company (11 digits). */
export function isValidItCodiceFiscale(value: string): boolean {
  return value.length === 11 ? isValidItPartitaIva(value) : isValidItPersonalCodiceFiscale(value);
}
