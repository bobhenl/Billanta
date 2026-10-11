import { describe, expect, it } from 'vitest';
import { czechAccountToIban, isValidCzechBankAccount, parseCzechBankAccount } from '../bank-account-validator.js';

/**
 * Checksum verification notes (weighted mod-11, computed by hand / by a small
 * script — see below — rather than trusted from an unverified online example):
 *
 * Weight tables:
 *   prefix (right-aligned, max 6):        10, 5, 8, 4, 2, 1
 *   account number (right-aligned, max 10): 6, 3, 7, 9, 10, 5, 8, 4, 2, 1
 *
 * 1) Prefix "19": right-aligned against the last two weights [2, 1]:
 *      1*2 + 9*1 = 2 + 9 = 11  → 11 % 11 === 0  ✓ valid prefix
 *
 * 2) Account number "2000145399": full 10-digit weight table
 *      [6, 3, 7, 9, 10, 5, 8, 4, 2, 1] against digits [2,0,0,0,1,4,5,3,9,9]:
 *      2*6 + 0*3 + 0*7 + 0*9 + 1*10 + 4*5 + 5*8 + 3*4 + 9*2 + 9*1
 *      = 12 + 0 + 0 + 0 + 10 + 20 + 40 + 12 + 18 + 9
 *      = 121
 *      121 % 11 === 0  ✓ valid account number
 *
 *   So "19-2000145399/0800" (a commonly used example CZ account number) is
 *   checksum-valid end to end, and is used below as the canonical valid case.
 *
 * 3) A second, independently constructed valid case without a prefix,
 *    "6112021268/0100" — digits [6,1,1,2,0,2,1,2,6,8] against
 *    [6, 3, 7, 9, 10, 5, 8, 4, 2, 1]:
 *      6*6 + 1*3 + 1*7 + 2*9 + 0*10 + 2*5 + 1*8 + 2*4 + 6*2 + 8*1
 *      = 36 + 3 + 7 + 18 + 0 + 10 + 8 + 8 + 12 + 8
 *      = 110
 *      110 % 11 === 0  ✓ valid account number
 *
 * 4) Mutating a single digit of the above valid number breaks the checksum:
 *    "6113021268" (the 4th digit changed from 2 to 3) sums to 111, which is
 *    not divisible by 11 → invalid. Used below as a "single-digit-typo is
 *    caught" regression case.
 */

describe('isValidCzechBankAccount', () => {
  it('accepts a valid account number with a checksum-valid prefix', () => {
    expect(isValidCzechBankAccount('19-2000145399/0800')).toBe(true);
  });

  it('accepts the same base account number without a prefix', () => {
    expect(isValidCzechBankAccount('2000145399/0800')).toBe(true);
  });

  it('accepts a second, independently hand-verified valid account number', () => {
    expect(isValidCzechBankAccount('6112021268/0100')).toBe(true);
  });

  it('rejects a single mistyped digit in an otherwise valid account number', () => {
    expect(isValidCzechBankAccount('6113021268/0100')).toBe(false);
  });

  it('rejects a checksum-invalid prefix even when the base number is valid', () => {
    // prefix "1" against weight 1 -> 1*1 = 1, 1 % 11 !== 0 -> invalid prefix
    expect(isValidCzechBankAccount('1-2000145399/0800')).toBe(false);
  });

  it('rejects a bank code that is not exactly 4 digits', () => {
    expect(isValidCzechBankAccount('2000145399/800')).toBe(false);
    expect(isValidCzechBankAccount('2000145399/08000')).toBe(false);
  });

  it('rejects malformed input entirely', () => {
    expect(isValidCzechBankAccount('not-an-account-number')).toBe(false);
    expect(isValidCzechBankAccount('')).toBe(false);
    expect(isValidCzechBankAccount('123456789012/0800')).toBe(false); // account number too long (>10 digits)
  });

  it('tolerates surrounding whitespace', () => {
    expect(isValidCzechBankAccount('  19-2000145399/0800  ')).toBe(true);
  });
});

describe('parseCzechBankAccount', () => {
  it('splits prefix, account number, and bank code', () => {
    expect(parseCzechBankAccount('19-2000145399/0800')).toEqual({
      prefix: '19',
      accountNumber: '2000145399',
      bankCode: '0800',
    });
  });

  it('returns a null prefix when none is present', () => {
    expect(parseCzechBankAccount('2000145399/0800')).toEqual({
      prefix: null,
      accountNumber: '2000145399',
      bankCode: '0800',
    });
  });

  it('returns null for unparsable input', () => {
    expect(parseCzechBankAccount('garbage')).toBeNull();
  });
});

describe('czechAccountToIban', () => {
  it('converts a prefixed domestic account to its IBAN', () => {
    // Example account from the ČBA QR Platba spec.
    expect(czechAccountToIban('19-2000145399/0800')).toBe('CZ6508000000192000145399');
  });

  it('accepts the bank code as a separate argument', () => {
    expect(czechAccountToIban('19-2000145399', '0800')).toBe('CZ6508000000192000145399');
  });

  it('zero-pads an account without a prefix', () => {
    const iban = czechAccountToIban('2000145399/0800')!;
    expect(iban).toMatch(/^CZ\d{2}08000000002000145399$/);
    // ISO 13616: moving the first four chars to the end, letters -> digits, mod 97 must be 1.
    const numeric = (iban.slice(4) + iban.slice(0, 4)).replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
    expect(BigInt(numeric) % 97n).toBe(1n);
  });

  it('returns null for unparsable input', () => {
    expect(czechAccountToIban('garbage')).toBeNull();
  });
});
