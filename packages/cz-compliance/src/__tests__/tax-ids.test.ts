import { describe, expect, it } from 'vitest';
import { checkTaxId, isValidIco } from '../tax-ids.js';

describe('isValidIco', () => {
  it('accepts IČOs with a correct mod-11 check digit', () => {
    expect(isValidIco('27082440')).toBe(true);
    expect(isValidIco('00006947')).toBe(true);
    // Old short numbers are left-padded with zeros.
    expect(isValidIco('6947')).toBe(true);
    expect(isValidIco('270 82 440')).toBe(true);
  });

  it('rejects a wrong check digit, letters and too many digits', () => {
    expect(isValidIco('27082441')).toBe(false);
    expect(isValidIco('12345678')).toBe(false);
    expect(isValidIco('2708244A')).toBe(false);
    expect(isValidIco('123456789')).toBe(false);
    expect(isValidIco('')).toBe(false);
  });

  it('handles the check digit 0 for remainders 0 and 1 (the "(11 − r) mod 10" rule)', () => {
    // 2*8+7*7+0+8*5+2*4+4*3+4*2 = 133, 133 mod 11 = 1 → (11 − 1) mod 10 = 0.
    expect(isValidIco('27082440')).toBe(true);
  });
});

describe('checkTaxId', () => {
  it('checks a Czech company DIČ with the IČO checksum', () => {
    expect(checkTaxId('CZ27082440')).toEqual({ kind: 'cz_dic', valid: true });
    expect(checkTaxId('cz 27082441')).toEqual({ kind: 'cz_dic', valid: false });
  });

  it('checks a Czech personal DIČ as a birth number (mod 11), with the pre-1985 exception', () => {
    expect(checkTaxId('CZ7103192745')).toEqual({ kind: 'cz_dic', valid: true });
    expect(checkTaxId('CZ7103192746')).toEqual({ kind: 'cz_dic', valid: false });
    // 9 digits mod 11 = 10 and a final 0 is a valid old birth number.
    const nine = Array.from({ length: 1000 }, (_, i) => String(100000000 + i)).find((d) => BigInt(d) % 11n === 10n)!;
    expect(checkTaxId(`CZ${nine}0`)).toEqual({ kind: 'cz_dic', valid: true });
    expect(checkTaxId('CZ123456789')).toEqual({ kind: 'cz_dic', valid: true });
    expect(checkTaxId('CZ1234')).toEqual({ kind: 'cz_dic', valid: false });
  });

  it('checks a Slovak IČ DPH: 10 digits divisible by 11, third digit 2/3/4/7/8/9', () => {
    expect(checkTaxId('SK2020317068')).toEqual({ kind: 'sk_ic_dph', valid: true });
    expect(checkTaxId('SK2020317069')).toEqual({ kind: 'sk_ic_dph', valid: false });
    // 2010317001 is divisible by 11 but its third digit is 1.
    expect(BigInt('2010317001') % 11n).toBe(0n);
    expect(checkTaxId('SK2010317001')).toEqual({ kind: 'sk_ic_dph', valid: false });
  });

  it('treats 10 bare digits as a Slovak DIČ and other prefixes as EU VAT IDs (format only)', () => {
    expect(checkTaxId('2020317068')).toEqual({ kind: 'sk_dic', valid: true });
    expect(checkTaxId('20203170')).toEqual({ kind: 'sk_dic', valid: false });
    expect(checkTaxId('DE123456789')).toEqual({ kind: 'eu_vat', valid: true });
    expect(checkTaxId('D-1')).toEqual({ kind: 'eu_vat', valid: false });
    expect(checkTaxId('  ')).toBeNull();
  });
});
