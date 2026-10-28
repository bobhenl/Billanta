import { describe, expect, it } from 'vitest';
import { countryPackProblems } from '../countries/contract.js';
import { AU, auDeadlines, auStateHolidays } from '../countries/au/index.js';
import { abnFromAcn, formatAbn, isValidAbn, isValidAcn, isValidBsbAccount } from '../countries/au/ids.js';
import { NZ, nzDeadlines } from '../countries/nz/index.js';
import { formatIrd, isValidIrd, isValidNzbn, isValidNzBankAccount } from '../countries/nz/ids.js';
import { SG, sgDeadlines, sgHolidays } from '../countries/sg/index.js';
import { isValidGstNo, isValidUen } from '../countries/sg/ids.js';

describe('AU / NZ / SG country packs', () => {
  it.each([AU, NZ, SG])('$code satisfies the contract', (pack) => {
    expect(countryPackProblems(pack)).toEqual([]);
  });

  it('have GST at 10 %, 15 % and 9 % today', () => {
    const current = (p: typeof AU) => p.indirectTax.rateSets.at(-1)!.rates.find((r) => r.kind === 'standard')!.rate;
    expect([current(AU), current(NZ), current(SG)]).toEqual([10, 15, 9]);
  });
});

describe('AU identifiers', () => {
  it('validates ABNs with the mod 89 check', () => {
    expect(isValidAbn('51 824 753 556')).toBe(true);
    expect(isValidAbn('83914571673')).toBe(true);
    expect(isValidAbn('99 999 999 999')).toBe(false);
    expect(isValidAbn('51 824 753 55')).toBe(false);
    expect(formatAbn('51824753556')).toBe('51 824 753 556');
  });

  it('validates ACNs and derives the ABN', () => {
    expect(isValidAcn('004 085 616')).toBe(true);
    expect(isValidAcn('010 499 966')).toBe(true);
    expect(isValidAcn('999 999 999')).toBe(false);
    expect(abnFromAcn('002 724 334')).toBe('43002724334');
  });

  it('checks the BSB + account format', () => {
    expect(isValidBsbAccount('062-000 12345678')).toBe(true);
    expect(isValidBsbAccount('062000/1234567')).toBe(true);
    expect(isValidBsbAccount('06200 1234')).toBe(false);
  });
});

describe('AU calendar', () => {
  it('lists the 2026 national holidays with the Boxing Day substitute', () => {
    expect(AU.holidays(2026)).toEqual([
      '2026-01-01', '2026-01-26', '2026-04-03', '2026-04-06', '2026-04-25', '2026-12-25', '2026-12-26', '2026-12-28',
    ]);
  });

  it('adds state Labour Day and King\'s Birthday', () => {
    expect(auStateHolidays(2026, 'AU-VIC')).toEqual(expect.arrayContaining(['2026-03-09', '2026-06-08']));
    expect(auStateHolidays(2026, 'QLD')).toEqual(expect.arrayContaining(['2026-05-04', '2026-10-05']));
    expect(auStateHolidays(2026, 'WA')).toEqual(expect.arrayContaining(['2026-03-02', '2026-09-28', '2026-04-27']));
  });

  it('moves the quarterly BAS due on Saturday 28 February 2026 to Monday', () => {
    const quarterly = auDeadlines(2026).filter((d) => d.kind === 'gst_bas_quarterly').map((d) => d.date);
    expect(quarterly).toEqual(['2026-03-02', '2026-04-28', '2026-07-28', '2026-10-28']);
  });
});

describe('NZ identifiers', () => {
  it('validates IRD numbers', () => {
    expect(isValidIrd('49-091-850')).toBe(true);
    expect(isValidIrd('49098576')).toBe(true);
    expect(isValidIrd('136410133')).toBe(false);
    expect(isValidIrd('9125568')).toBe(false);
    expect(formatIrd('49091850')).toBe('49-091-850');
  });

  it('validates NZBNs with the GS1 check digit', () => {
    expect(isValidNzbn('9429000000017')).toBe(true);
    expect(isValidNzbn('9429041234563')).toBe(true);
    expect(isValidNzbn('9429041234564')).toBe(false);
    expect(isValidNzbn('1429041234563')).toBe(false);
  });

  it('checks the bank account format', () => {
    expect(isValidNzBankAccount('12-3456-7890123-00')).toBe(true);
    expect(isValidNzBankAccount('12-3456-7890123-001')).toBe(true);
    expect(isValidNzBankAccount('12-3456-789012-00')).toBe(false);
  });
});

describe('NZ calendar', () => {
  it('lists the 2026 holidays with Matariki and the Mondayised days', () => {
    expect(NZ.holidays(2026)).toEqual([
      '2026-01-01', '2026-01-02', '2026-02-06', '2026-04-03', '2026-04-06', '2026-04-25', '2026-04-27',
      '2026-06-01', '2026-07-10', '2026-10-26', '2026-12-25', '2026-12-26', '2026-12-28',
    ]);
  });

  it('applies the 15 January and 7 May exceptions and rolls weekends', () => {
    const dates = nzDeadlines(2026).map((d) => d.date);
    expect(dates).toHaveLength(12);
    expect(dates).toContain('2026-01-15');
    expect(dates).toContain('2026-05-07');
    // January period: 28 February 2026 is a Saturday.
    expect(dates).toContain('2026-03-02');
    expect(dates).not.toContain('2026-04-28');
  });
});

describe('SG identifiers', () => {
  it('validates UENs of all three shapes', () => {
    expect(isValidUen('00192200M')).toBe(true);
    expect(isValidUen('197401143C')).toBe(true);
    expect(isValidUen('S16FC0121D')).toBe(true);
    expect(isValidUen('T01FC6132D')).toBe(true);
    expect(isValidUen('00192200A')).toBe(false);
    expect(isValidUen('197401143D')).toBe(false);
    expect(isValidUen('S16FC0121E')).toBe(false);
    expect(isValidUen('S16ZZ0121D')).toBe(false);
  });

  it('accepts M-format and UEN-based GST numbers', () => {
    expect(isValidGstNo('M2-0012345-X')).toBe(true);
    expect(isValidGstNo('197401143C')).toBe(true);
    expect(isValidGstNo('M2-00123-X')).toBe(false);
  });
});

describe('SG calendar', () => {
  it('lists the gazetted 2026 holidays', () => {
    expect(SG.holidays(2026)).toEqual([
      '2026-01-01', '2026-02-17', '2026-02-18', '2026-03-21', '2026-04-03', '2026-05-01', '2026-05-27',
      '2026-05-31', '2026-06-01', '2026-08-09', '2026-08-10', '2026-11-08', '2026-11-09', '2026-12-25',
    ]);
  });

  it('falls back to fixed holidays with Sunday substitutes', () => {
    // 2027: National Day 9 August is a Monday; 1 January a Friday; Good Friday 26 March.
    expect(sgHolidays(2027)).toEqual(['2027-01-01', '2027-03-26', '2027-05-01', '2027-08-09', '2027-12-25']);
    // 25 December 2033 is a Sunday.
    expect(sgHolidays(2033)).toContain('2033-12-26');
  });

  it('puts the GST F5 one month after each calendar quarter', () => {
    expect(sgDeadlines(2026).map((d) => d.date)).toEqual(['2026-01-31', '2026-04-30', '2026-07-31', '2026-10-31']);
  });
});
