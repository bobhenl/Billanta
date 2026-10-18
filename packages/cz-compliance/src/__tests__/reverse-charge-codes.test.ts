import { describe, expect, it } from 'vitest';
import { REVERSE_CHARGE_CODES, REVERSE_CHARGE_CODE_VALUES, isReverseChargeCode } from '../reverse-charge-codes.js';

describe('REVERSE_CHARGE_CODES', () => {
  it('lists the codes EPO accepts today, in číselník order', () => {
    expect(REVERSE_CHARGE_CODE_VALUES).toEqual([
      '1', '1a', '3', '3a', '4', '4a', '5', '6', '7',
      '11', '12', '13', '14', '15', '16', '17', '18', '19', '20', '21'
    ]);
  });

  it('keeps every code unique and within the 3 characters kod_pred_pl allows', () => {
    expect(new Set(REVERSE_CHARGE_CODE_VALUES).size).toBe(REVERSE_CHARGE_CODES.length);
    for (const c of REVERSE_CHARGE_CODES) expect(c.code.length).toBeLessThanOrEqual(3);
  });

  it('uses the official numbering (14 is mobile phones, 4 is construction)', () => {
    const name = (code: string) => REVERSE_CHARGE_CODES.find((c) => c.code === code)?.name;
    expect(name('4')).toBe('Stavební a montážní práce');
    expect(name('14')).toBe('Mobilní telefony');
    expect(name('21')).toBe('Poskytnutí vymezených služeb elektronických komunikací');
  });
});

describe('isReverseChargeCode', () => {
  it('accepts listed codes only', () => {
    expect(isReverseChargeCode('4')).toBe(true);
    expect(isReverseChargeCode('1a')).toBe(true);
    // Code 2 (povolenky) ended in 2014, customs tariff numbers in 2011.
    expect(isReverseChargeCode('2')).toBe(false);
    expect(isReverseChargeCode('7204')).toBe(false);
    expect(isReverseChargeCode('1A')).toBe(false);
    expect(isReverseChargeCode(4)).toBe(false);
    expect(isReverseChargeCode(null)).toBe(false);
  });
});
