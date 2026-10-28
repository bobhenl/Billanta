import { describe, expect, it } from 'vitest';
import { countryPackProblems } from '../countries/contract.js';
import { CY } from '../countries/cy/index.js';
import { isValidTic } from '../countries/cy/tic.js';
import { isValidAfm } from '../countries/gr/afm.js';
import { GR } from '../countries/gr/index.js';
import { orthodoxEaster, isoDate } from '../countries/gr/orthodox-easter.js';
import { HR } from '../countries/hr/index.js';
import { isValidOib } from '../countries/hr/oib.js';
import { SI } from '../countries/si/index.js';
import { isValidSiTaxNumber } from '../countries/si/tax-id.js';

describe('SI, HR, GR and CY country packs', () => {
  it.each([SI, HR, GR, CY])('$code passes the contract checks', (pack) => {
    expect(countryPackProblems(pack)).toEqual([]);
  });
});

describe('tax ID validators', () => {
  it('SI davčna številka', () => {
    expect(isValidSiTaxNumber('47939664')).toBe(true);
    expect(isValidSiTaxNumber('SI 4793 9664')).toBe(true);
    expect(isValidSiTaxNumber('47939665')).toBe(false);
    // The first digit is never 0.
    expect(isValidSiTaxNumber('07939664')).toBe(false);
    expect(isValidSiTaxNumber('4793966')).toBe(false);
  });

  it('HR OIB (ISO 7064 MOD 11,10)', () => {
    expect(isValidOib('81793146560')).toBe(true);
    expect(isValidOib('HR81793146560')).toBe(true);
    expect(isValidOib('81793146561')).toBe(false);
    expect(isValidOib('8179314656')).toBe(false);
  });

  it('GR ΑΦΜ (mod 11)', () => {
    expect(isValidAfm('094019245')).toBe(true);
    expect(isValidAfm('EL094019245')).toBe(true);
    expect(isValidAfm('094019246')).toBe(false);
    expect(isValidAfm('000000000')).toBe(false);
  });

  it('CY TIC', () => {
    expect(isValidTic('10259033P')).toBe(true);
    expect(isValidTic('CY10259033P')).toBe(true);
    expect(isValidTic('10259033Q')).toBe(false);
    // Numbers starting with 12 are not issued, and 2/6/7/8 are not valid first digits.
    expect(isValidTic('12000000A')).toBe(false);
    expect(isValidTic('60000000A')).toBe(false);
  });

  it('the VAT IDs carry the country prefix', () => {
    expect(SI.taxIds.find((t) => t.kind === 'vat')!.normalize('47939664')).toBe('SI47939664');
    expect(HR.taxIds.find((t) => t.kind === 'vat')!.normalize('81793146560')).toBe('HR81793146560');
    expect(GR.taxIds.find((t) => t.kind === 'vat')!.normalize('GR094019245')).toBe('EL094019245');
    expect(CY.taxIds.find((t) => t.kind === 'vat')!.normalize('10259033P')).toBe('CY10259033P');
  });
});

describe('Orthodox Easter', () => {
  it.each([
    [2024, '2024-05-05'],
    [2025, '2025-04-20'],
    [2026, '2026-04-12'],
    [2027, '2027-05-02'],
  ])('%i', (year, expected) => {
    expect(isoDate(orthodoxEaster(year))).toBe(expected);
  });

  it('rejects years outside 1900–2099', () => {
    expect(() => orthodoxEaster(2100)).toThrow(RangeError);
  });
});

describe('2026 public holidays', () => {
  it('SI', () => {
    expect(SI.holidays(2026)).toEqual([
      '2026-01-01', '2026-01-02', '2026-02-08', '2026-04-05', '2026-04-06', '2026-04-27', '2026-05-01',
      '2026-05-02', '2026-05-24', '2026-06-25', '2026-08-15', '2026-10-31', '2026-11-01', '2026-12-25',
      '2026-12-26',
    ]);
  });

  it('HR', () => {
    expect(HR.holidays(2026)).toEqual([
      '2026-01-01', '2026-01-06', '2026-04-05', '2026-04-06', '2026-05-01', '2026-05-30', '2026-06-04',
      '2026-06-22', '2026-08-05', '2026-08-15', '2026-11-01', '2026-11-18', '2026-12-25', '2026-12-26',
    ]);
  });

  it('GR', () => {
    expect(GR.holidays(2026)).toEqual([
      '2026-01-01', '2026-01-06', '2026-02-23', '2026-03-25', '2026-04-10', '2026-04-12', '2026-04-13',
      '2026-05-01', '2026-06-01', '2026-08-15', '2026-10-28', '2026-12-25', '2026-12-26',
    ]);
  });

  it('CY', () => {
    expect(CY.holidays(2026)).toEqual([
      '2026-01-01', '2026-01-06', '2026-02-23', '2026-03-25', '2026-04-01', '2026-04-10', '2026-04-12',
      '2026-04-13', '2026-04-14', '2026-05-01', '2026-06-01', '2026-08-15', '2026-10-01', '2026-10-28',
      '2026-12-25', '2026-12-26',
    ]);
  });
});

describe('2026 VAT deadlines', () => {
  const dates = (pack: typeof SI) => pack.deadlines!(2026).map((d) => d.date);

  it('SI: last working day of the month', () => {
    // 2026-01-31 is a Saturday.
    expect(dates(SI)).toContain('2026-01-30');
    expect(dates(SI)).toHaveLength(12);
  });

  it('HR: the 20th, moved past weekends and holidays', () => {
    // 2026-06-20 is a Saturday and Monday 06-22 is Anti-Fascist Struggle Day.
    expect(dates(HR)).toContain('2026-06-23');
    expect(dates(HR)).toContain('2026-01-20');
  });

  it('GR: last working day of the month', () => {
    // 2026-05-31 is a Sunday.
    expect(dates(GR)).toContain('2026-05-29');
    expect(dates(GR)).toHaveLength(12);
  });

  it('CY: quarterly, on the 10th of the second month', () => {
    expect(dates(CY)).toEqual(['2026-02-10', '2026-05-10', '2026-08-10', '2026-11-10']);
  });
});
