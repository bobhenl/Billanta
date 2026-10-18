/**
 * Czech (and, by convention, Slovak) bank account number validation.
 *
 * A Czech domestic account number has the form:
 *
 *   [prefix-]accountNumber/bankCode
 *
 * - `prefix`  ("předčíslí"): optional, 1–6 digits.
 * - `accountNumber` ("základní část"/"číslo účtu"): required, 2–10 digits.
 * - `bankCode` ("kód banky"): required, exactly 4 digits (assigned by the ČNB
 *   bank-code registry — this module does not validate it against the
 *   registry, only its format).
 *
 * Both `prefix` and `accountNumber` are independently checksummed with a
 * weighted mod-11 algorithm (this is the standard, publicly documented
 * Czech banking algorithm, per ČNB's account-number specification):
 *
 *   1. Right-align the digits of the part against the weight table below
 *      (i.e. the last digit gets the last weight, working backwards).
 *   2. Multiply each digit by its aligned weight and sum the products.
 *   3. The part is valid iff that sum is evenly divisible by 11.
 *
 * Weight tables (rightmost weight applies to the rightmost/last digit):
 *   prefix (max 6 digits):         10, 5, 8, 4, 2, 1
 *   account number (max 10 digits): 6, 3, 7, 9, 10, 5, 8, 4, 2, 1
 *
 * An absent prefix is treated as all-zero, which trivially satisfies the
 * checksum (sum = 0), matching real-world behavior where most accounts have
 * no prefix at all.
 */

const PREFIX_WEIGHTS = [10, 5, 8, 4, 2, 1];
const ACCOUNT_NUMBER_WEIGHTS = [6, 3, 7, 9, 10, 5, 8, 4, 2, 1];

/**
 * Format: optional 1-6 digit prefix + '-', then 2-10 digit account number,
 * then '/', then exactly 4 digit bank code.
 */
const ACCOUNT_NUMBER_PATTERN = /^(?:(\d{1,6})-)?(\d{2,10})\/(\d{4})$/;

/**
 * Checks a digit string against a mod-11 weight table, right-aligning the
 * digits to the end of the weight table (i.e. shorter inputs are treated as
 * if left-padded with zeros).
 */
function passesWeightedMod11(digits: string, weights: number[]): boolean {
  if (digits.length > weights.length) {
    return false;
  }

  const offset = weights.length - digits.length;
  let sum = 0;

  for (let i = 0; i < digits.length; i++) {
    const digit = Number(digits[i]);
    const weight = weights[offset + i]!;
    sum += digit * weight;
  }

  return sum % 11 === 0;
}

export interface ParsedCzechBankAccount {
  prefix: string | null;
  accountNumber: string;
  bankCode: string;
}

/**
 * Parses a Czech bank account number string into its constituent parts
 * without validating checksums. Returns `null` if the string doesn't match
 * the expected `[prefix-]accountNumber/bankCode` shape.
 */
export function parseCzechBankAccount(accountNumber: string): ParsedCzechBankAccount | null {
  const match = ACCOUNT_NUMBER_PATTERN.exec(accountNumber.trim());
  if (!match) {
    return null;
  }

  const [, prefix, number, bankCode] = match;
  return {
    prefix: prefix ?? null,
    accountNumber: number!,
    bankCode: bankCode!,
  };
}

/**
 * Validates a Czech bank account number of the form `[prefix-]number/bankCode`
 * using the standard weighted mod-11 checksum on both the prefix and the base
 * account number.
 *
 * This validates structural/checksum correctness only — it does not verify
 * that `bankCode` corresponds to a real, currently-operating bank (that would
 * require checking against the ČNB bank-code registry, which is out of scope
 * for this pure-function validator).
 */
export function isValidCzechBankAccount(accountNumber: string): boolean {
  const parsed = parseCzechBankAccount(accountNumber);
  if (!parsed) {
    return false;
  }

  const { prefix, accountNumber: number, bankCode } = parsed;

  if (!/^\d{4}$/.test(bankCode)) {
    return false;
  }

  if (prefix !== null && !passesWeightedMod11(prefix, PREFIX_WEIGHTS)) {
    return false;
  }

  if (!passesWeightedMod11(number, ACCOUNT_NUMBER_WEIGHTS)) {
    return false;
  }

  return true;
}

/**
 * Converts a Czech domestic account (`[prefix-]number/bankCode`) to its IBAN,
 * so a supplier who only filled in the domestic number still gets a QR
 * payment code. Ported from Faktorio's `normalizeAccountNumberForQrPayment`
 * (upstream commit 6f8149b).
 *
 * BBAN = bankCode(4) + prefix(6, zero-padded) + number(10, zero-padded); the
 * check digits are ISO 13616 mod-97 over BBAN + "CZ00" ("CZ" -> 12 35).
 * Returns `null` when the input does not parse; the checksum is not
 * validated here (use `isValidCzechBankAccount` for that).
 */
export function czechAccountToIban(accountNumber: string, bankCode?: string | null): string | null {
  const compact = accountNumber.replace(/\s+/g, '');
  const parsed = parseCzechBankAccount(bankCode && !compact.includes('/') ? `${compact}/${bankCode}` : compact);
  if (!parsed) {
    return null;
  }

  const bban = `${parsed.bankCode}${(parsed.prefix ?? '').padStart(6, '0')}${parsed.accountNumber.padStart(10, '0')}`;
  let remainder = 0;
  for (const digit of `${bban}123500`) {
    remainder = (remainder * 10 + Number(digit)) % 97;
  }
  return `CZ${String(98 - remainder).padStart(2, '0')}${bban}`;
}

/** "CZ65 0800 0000 1920 0014 5399" or lowercase → "CZ6508000000192000145399"; anything else unchanged. */
export function normalizeIban(iban: string): string {
  return iban.replace(/[\s-]+/g, '').toUpperCase();
}

/** Length of the IBAN per country, for the countries our users invoice most (ISO 13616 registry). */
const IBAN_LENGTHS: Record<string, number> = {
  AT: 20, BE: 16, CH: 21, CZ: 24, DE: 22, DK: 18, ES: 24, FI: 18, FR: 27, GB: 22, HR: 21, HU: 28,
  IE: 22, IT: 27, LT: 20, LU: 20, NL: 18, NO: 15, PL: 28, PT: 25, RO: 24, SE: 24, SI: 19, SK: 24,
};

/**
 * ISO 13616 check: shape, the known length for the country and the mod-97
 * check digits. A country missing from IBAN_LENGTHS only has to be 15–34
 * characters long.
 */
export function isValidIban(iban: string): boolean {
  const value = normalizeIban(iban);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(value)) {
    return false;
  }
  const expected = IBAN_LENGTHS[value.slice(0, 2)];
  if (expected !== undefined && value.length !== expected) {
    return false;
  }
  let remainder = 0;
  for (const ch of value.slice(4) + value.slice(0, 4)) {
    const code = ch.charCodeAt(0);
    const digits = code >= 65 ? String(code - 55) : ch;
    for (const digit of digits) {
      remainder = (remainder * 10 + Number(digit)) % 97;
    }
  }
  return remainder === 1;
}

/**
 * The domestic form of a Czech or Slovak IBAN: "CZ65 0800 0000 1920 0014 5399"
 * → "19-2000145399/0800". Both countries share the BBAN layout (bank code,
 * prefix, number). Returns null for other countries or a malformed IBAN; the
 * check digits are not validated here (use `isValidIban`).
 */
export function ibanToCzechAccount(iban: string): string | null {
  const value = normalizeIban(iban);
  const match = /^(CZ|SK)\d{2}(\d{4})(\d{6})(\d{10})$/.exec(value);
  if (!match) {
    return null;
  }
  const [, , bankCode, prefix, number] = match;
  const p = prefix!.replace(/^0+/, '');
  const n = number!.replace(/^0+/, '').padStart(2, '0');
  return `${p ? `${p}-` : ''}${n}/${bankCode}`;
}
