import { describe, expect, it } from 'vitest';
import {
  defaultNumberPattern,
  effectiveNumberPattern,
  findNumberPatternClash,
  numberPeriod,
  numberResetPeriod,
  parseDocumentNumber,
  renderDocumentNumber,
  validateNumberPattern,
} from '../number-format.js';

describe('renderDocumentNumber', () => {
  const at = { year: 2026, month: 3, sequence: 7 };

  it('renders the built-in patterns exactly like the old hard-coded format', () => {
    expect(renderDocumentNumber(defaultNumberPattern('invoice'), at)).toBe('2026-0007');
    expect(renderDocumentNumber(defaultNumberPattern('proforma'), at)).toBe('ZF2026-0007');
    expect(renderDocumentNumber(defaultNumberPattern('credit_note'), at)).toBe('OD2026-0007');
    expect(renderDocumentNumber(defaultNumberPattern('quote'), at)).toBe('NA2026-0007');
    expect(renderDocumentNumber('{YYYY}-{NNNN}', { ...at, sequence: 12345 })).toBe('2026-12345');
  });

  it('renders every token', () => {
    expect(renderDocumentNumber('{N}/{MM}/{YYYY}', { year: 2026, month: 10, sequence: 1 })).toBe('1/10/2026');
    expect(renderDocumentNumber('{N}/{MM}/{YYYY}', at)).toBe('7/03/2026');
    expect(renderDocumentNumber('FV{YYYY}{NNN}', at)).toBe('FV2026007');
    expect(renderDocumentNumber('{YY}{NNNN}', at)).toBe('260007');
    expect(renderDocumentNumber('{YY}{NN}', { year: 2005, month: 1, sequence: 3 })).toBe('0503');
    expect(renderDocumentNumber('A.{YYYY}_{NNNNN} x', at)).toBe('A.2026_00007 x');
  });

  it('throws on an invalid pattern', () => {
    expect(() => renderDocumentNumber('{YYYY}', at)).toThrow();
  });
});

describe('validateNumberPattern', () => {
  it('accepts the presets and literal text', () => {
    for (const p of ['{YYYY}-{NNNN}', '{N}/{MM}/{YYYY}', 'FV{YYYY}{NNN}', '{YY}{NNNN}', 'Fa 2/{YY}.{NN}_x']) {
      expect(validateNumberPattern(p)).toBeNull();
    }
  });

  it('names what is wrong', () => {
    expect(validateNumberPattern('')).toBe('empty');
    expect(validateNumberPattern('   ')).toBe('empty');
    expect(validateNumberPattern('{YYYY}#{N}')).toBe('invalid_character');
    expect(validateNumberPattern('{YYYY}-{N}č')).toBe('invalid_character');
    expect(validateNumberPattern('{YYYY}-{N}}')).toBe('invalid_character');
    expect(validateNumberPattern('{YYYY}-{DD}{N}')).toBe('unknown_token');
    expect(validateNumberPattern('{YYYY}-{NNNNNN}')).toBe('unknown_token');
    expect(validateNumberPattern('{YYYY}-{yyyy}{N}')).toBe('unknown_token');
    expect(validateNumberPattern('FV-{YYYY}')).toBe('no_sequence');
    expect(validateNumberPattern('{YYYY}-{N}-{NN}')).toBe('multiple_sequences');
    expect(validateNumberPattern('FV{NNNN}')).toBe('no_year');
    expect(validateNumberPattern('{YYYY}{YY}{N}')).toBe('multiple_years');
    expect(validateNumberPattern('{YYYY}{MM}{MM}{N}')).toBe('multiple_months');
  });

  it('keeps the rendered number within 32 characters', () => {
    // 22 literal + 4 year + 6 digits = 32 fits; one more character does not.
    expect(validateNumberPattern('ABCDEFGHIJKLMNOPQRSTUV{YYYY}{N}')).toBeNull();
    expect(validateNumberPattern('ABCDEFGHIJKLMNOPQRSTUVW{YYYY}{N}')).toBe('too_long');
  });
});

describe('numberResetPeriod / numberPeriod', () => {
  it('resets monthly only when the pattern shows the month', () => {
    expect(numberResetPeriod('{N}/{MM}/{YYYY}')).toBe('monthly');
    expect(numberResetPeriod('{YYYY}-{NNNN}')).toBe('yearly');
    expect(numberResetPeriod('FV{YYYY}{NNN}')).toBe('yearly');
  });

  it('uses month 0 for a yearly counter', () => {
    const oct = new Date(2026, 9, 14);
    expect(numberPeriod('{N}/{MM}/{YYYY}', oct)).toEqual({ year: 2026, month: 10 });
    expect(numberPeriod('{YYYY}-{NNNN}', oct)).toEqual({ year: 2026, month: 0 });
    expect(numberPeriod('{N}/{MM}/{YYYY}', new Date(2027, 0, 1))).toEqual({ year: 2027, month: 1 });
  });
});

describe('parseDocumentNumber', () => {
  it('reads a BitFaktura-style number back', () => {
    expect(parseDocumentNumber('{N}/{MM}/{YYYY}', '14/10/2026')).toEqual({ year: 2026, month: 10, sequence: 14 });
    expect(parseDocumentNumber('{N}/{MM}/{YYYY}', '3/1/2026')).toEqual({ year: 2026, month: 1, sequence: 3 });
  });

  it('reads yearly patterns with month 0', () => {
    expect(parseDocumentNumber('{YYYY}-{NNNN}', '2026-0042')).toEqual({ year: 2026, month: 0, sequence: 42 });
    expect(parseDocumentNumber('FV{YYYY}{NNN}', 'FV2026007')).toEqual({ year: 2026, month: 0, sequence: 7 });
    expect(parseDocumentNumber('FV{YYYY}{NNN}', 'FV20261234')).toEqual({ year: 2026, month: 0, sequence: 1234 });
    expect(parseDocumentNumber('{YY}{NNNN}', '260015')).toEqual({ year: 2026, month: 0, sequence: 15 });
    expect(parseDocumentNumber('ZF{YYYY}-{NNNN}', 'ZF2025-0003')).toEqual({ year: 2025, month: 0, sequence: 3 });
  });

  it('treats literal text literally', () => {
    expect(parseDocumentNumber('A.{YYYY}-{N}', 'A.2026-5')).toEqual({ year: 2026, month: 0, sequence: 5 });
    expect(parseDocumentNumber('A.{YYYY}-{N}', 'AX2026-5')).toBeNull();
  });

  it('rejects numbers that do not fit', () => {
    expect(parseDocumentNumber('{YYYY}-{NNNN}', 'ZF2026-0042')).toBeNull();
    expect(parseDocumentNumber('{YYYY}-{NNNN}', '2026-042')).toBeNull();
    expect(parseDocumentNumber('{YYYY}-{NNNN}', '2026-0042x')).toBeNull();
    expect(parseDocumentNumber('{N}/{MM}/{YYYY}', '1/13/2026')).toBeNull();
    expect(parseDocumentNumber('{N}/{MM}/{YYYY}', '1/0/2026')).toBeNull();
    expect(parseDocumentNumber('{N}/{MM}/{YYYY}', '0/10/2026')).toBeNull();
    expect(parseDocumentNumber('{YYYY}', '2026')).toBeNull();
  });

  it('round-trips what it renders', () => {
    for (const pattern of ['{N}/{MM}/{YYYY}', 'FV{YYYY}{NNN}', '{YY}{NNNN}', '{YYYY}-{NNNN}', '{MM}{YY}-{NN}']) {
      const values = { year: 2026, month: 11, sequence: 123 };
      const parsed = parseDocumentNumber(pattern, renderDocumentNumber(pattern, values));
      expect(parsed).toEqual({ ...values, month: numberResetPeriod(pattern) === 'monthly' ? 11 : 0 });
    }
  });
});

describe('effectiveNumberPattern / findNumberPatternClash', () => {
  it('falls back to the built-in pattern', () => {
    expect(effectiveNumberPattern(null, 'proforma')).toBe('ZF{YYYY}-{NNNN}');
    expect(effectiveNumberPattern({ invoice: 'FV{YYYY}{NNN}' }, 'proforma')).toBe('ZF{YYYY}-{NNNN}');
    expect(effectiveNumberPattern({ invoice: 'FV{YYYY}{NNN}' }, 'invoice')).toBe('FV{YYYY}{NNN}');
  });

  it('finds two document types with the same pattern', () => {
    expect(findNumberPatternClash(null)).toBeNull();
    expect(findNumberPatternClash({ invoice: '{N}/{MM}/{YYYY}' })).toBeNull();
    expect(findNumberPatternClash({ invoice: 'ZF{YYYY}-{NNNN}' })).toBe('proforma');
    expect(findNumberPatternClash({ quote: '{YYYY}-{NNNN}' })).toBe('quote');
  });
});
