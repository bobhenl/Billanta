import { describe, expect, it } from 'vitest';
import { BG } from '../countries/bg/index.js';
import { isValidBgVatId, isValidEgn, isValidEik, isValidLnch } from '../countries/bg/tax-ids.js';
import { countryPackProblems } from '../countries/contract.js';
import { HU } from '../countries/hu/index.js';
import { isValidAdoszam, isValidCegjegyzekszam, isValidHuVatId, normalizeAdoszam } from '../countries/hu/tax-ids.js';
import { RO } from '../countries/ro/index.js';
import { isoDate, orthodoxEaster } from '../countries/ro/calendar.js';
import { isValidCui, isValidRoVatId, isValidTradeRegister, normalizeCui, normalizeRoVatId } from '../countries/ro/tax-ids.js';

const currentRates = (pack: typeof HU) => pack.indirectTax.rateSets.at(-1)!.rates.map((r) => r.rate);

describe('HU, RO and BG packs meet the contract', () => {
  it.each([HU, RO, BG])('$code has no contract problems', (pack) => {
    expect(countryPackProblems(pack)).toEqual([]);
  });

  it('carries the current rates, currencies and minor units', () => {
    expect(currentRates(HU)).toEqual([27, 18, 5]);
    expect(currentRates(RO)).toEqual([21, 11]);
    expect(currentRates(BG)).toEqual([20, 9]);
    expect(HU.currencyMinorUnits).toBe(0);
    expect(RO.currency).toBe('RON');
    expect(BG.currency).toBe('EUR');
  });

  it('switches Romania to 21 / 11 % on 1 August 2025', () => {
    const sets = RO.indirectTax.rateSets;
    expect(sets.at(-1)!.validFrom).toBe('2025-08-01');
    expect(sets.at(-2)!.rates[0]!.rate).toBe(19);
  });

  it('reports every Hungarian invoice in real time and clears every Romanian one', () => {
    expect(HU.einvoicing.map((m) => [m.scope, m.model])).toEqual([
      ['b2b', 'real_time_reporting'],
      ['b2c', 'real_time_reporting'],
    ]);
    expect(RO.einvoicing.every((m) => m.model === 'clearance' && m.formats.includes('ubl_cius_ro'))).toBe(true);
  });
});

describe('Hungarian tax IDs', () => {
  it('checks the törzsszám digit, the VAT code and the county', () => {
    expect(isValidAdoszam('12345676-2-41')).toBe(true);
    expect(isValidAdoszam('12345675-2-41')).toBe(false); // check digit
    expect(isValidAdoszam('12345676-6-41')).toBe(false); // VAT code 6 does not exist
    expect(isValidAdoszam('12345676-2-21')).toBe(false); // no county 21
    expect(isValidAdoszam('12345676-2-51')).toBe(true);
  });

  it('normalizes the undashed form', () => {
    expect(normalizeAdoszam('12345676 2 41')).toBe('12345676-2-41');
    expect(normalizeAdoszam('12345676241')).toBe('12345676-2-41');
  });

  it('validates the EU VAT ID and the company register number', () => {
    expect(isValidHuVatId('HU12345676')).toBe(true);
    expect(isValidHuVatId('HU12345677')).toBe(false);
    expect(isValidCegjegyzekszam('01-09-123456')).toBe(true);
    expect(isValidCegjegyzekszam('21-09-123456')).toBe(false);
  });
});

describe('Romanian tax IDs', () => {
  it('checks the CUI control key, short CUIs included', () => {
    expect(isValidCui('4221306')).toBe(true);
    expect(isValidCui('12345674')).toBe(true);
    expect(isValidCui('12345675')).toBe(false);
    expect(isValidCui('1')).toBe(false);
    expect(isValidCui('12345678901')).toBe(false);
  });

  it('normalizes and validates the RO VAT ID', () => {
    expect(normalizeCui('RO 4221306')).toBe('4221306');
    expect(normalizeRoVatId('4221306')).toBe('RO4221306');
    expect(isValidRoVatId('RO4221306')).toBe(true);
    expect(isValidRoVatId('RO4221307')).toBe(false);
  });

  it('accepts the old and the new trade register formats', () => {
    expect(isValidTradeRegister('J40/1234/2020')).toBe(true);
    expect(isValidTradeRegister('J2024001234408')).toBe(true);
    expect(isValidTradeRegister('X40/1234/2020')).toBe(false);
  });
});

describe('Bulgarian tax IDs', () => {
  it('checks the 9- and 13-digit ЕИК, including the second weight set', () => {
    expect(isValidEik('123456786')).toBe(true);
    expect(isValidEik('123456787')).toBe(false);
    expect(isValidEik('1234567860001')).toBe(true);
    expect(isValidEik('1234567860002')).toBe(false);
    // 00000001x: first sum 8 → check 8; 10000001x: sum 1 + 8 = 9.
    expect(isValidEik('000000018')).toBe(true);
  });

  it('accepts a VAT ID built on an ЕИК, an ЕГН or an ЛНЧ', () => {
    expect(isValidBgVatId('BG123456786')).toBe(true);
    expect(isValidBgVatId('BG7501010004')).toBe(true);
    expect(isValidBgVatId('BG123456787')).toBe(false);
    expect(isValidEgn('7501010004')).toBe(true);
    expect(isValidEgn('7513010003')).toBe(false); // month 13
    expect(isValidLnch('1001000000')).toBe(false);
  });
});

describe('Orthodox Easter', () => {
  it.each([
    [2024, '2024-05-05'],
    [2025, '2025-04-20'],
    [2026, '2026-04-12'],
    [2027, '2027-05-02'],
  ])('falls in %i on %s', (year, date) => {
    expect(isoDate(orthodoxEaster(year))).toBe(date);
  });
});

describe('2026 holidays', () => {
  it('Hungary (Western Easter, Pentecost Monday, no 24 December)', () => {
    expect(HU.holidays(2026)).toEqual([
      '2026-01-01', '2026-03-15', '2026-04-03', '2026-04-05', '2026-04-06', '2026-05-01',
      '2026-05-24', '2026-05-25', '2026-08-20', '2026-10-23', '2026-11-01', '2026-12-25', '2026-12-26',
    ]);
  });

  it('Romania (Orthodox Easter; Rusalii Monday coincides with Children\'s Day)', () => {
    expect(RO.holidays(2026)).toEqual([
      '2026-01-01', '2026-01-02', '2026-01-06', '2026-01-07', '2026-01-24', '2026-04-10',
      '2026-04-12', '2026-04-13', '2026-05-01', '2026-05-31', '2026-06-01', '2026-08-15',
      '2026-11-30', '2026-12-01', '2026-12-25', '2026-12-26',
    ]);
  });

  it('Bulgaria (Orthodox Easter and the weekend substitute days)', () => {
    expect(BG.holidays(2026)).toEqual([
      '2026-01-01', '2026-03-03', '2026-04-10', '2026-04-11', '2026-04-12', '2026-04-13',
      '2026-05-01', '2026-05-06', '2026-05-24', '2026-05-25', '2026-09-06', '2026-09-07',
      '2026-09-22', '2026-12-24', '2026-12-25', '2026-12-26', '2026-12-28',
    ]);
  });

  it('Bulgaria moves 1 May 2021 (Holy Saturday) to the first day after Easter Monday', () => {
    expect(BG.holidays(2021)).toContain('2021-05-04');
  });
});

describe('deadlines', () => {
  it('moves a VAT deadline off a weekend or holiday', () => {
    // BG: 14 June 2026 is a Sunday → Monday 15 June.
    expect(BG.deadlines!(2026).filter((d) => d.kind === 'vat_return').map((d) => d.date)).toContain('2026-06-15');
    // RO: 25 January 2026 is a Sunday → Monday 26 January.
    expect(RO.deadlines!(2026).find((d) => d.kind === 'vat_return')!.date).toBe('2026-01-26');
    // HU: 20 April 2026 is a Monday and stays.
    expect(HU.deadlines!(2026).filter((d) => d.kind === 'vat_return').map((d) => d.date)).toContain('2026-04-20');
  });

  it('lists twelve monthly VAT returns per year', () => {
    for (const pack of [HU, RO, BG]) {
      expect(pack.deadlines!(2026).filter((d) => d.kind === 'vat_return')).toHaveLength(12);
    }
  });
});
