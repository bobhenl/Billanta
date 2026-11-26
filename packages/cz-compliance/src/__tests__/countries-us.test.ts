import { describe, expect, it } from 'vitest';
import { countryPackProblems } from '../countries/contract.js';
import {
  isItinShape,
  isSsnShape,
  nextIrsBusinessDay,
  reachesEconomicNexus,
  US,
  US_ECONOMIC_NEXUS,
  usFederalHolidays,
  usStateRate,
  validateAbaRouting,
  validateEin,
  validateUsAccount,
} from '../countries/us/index.js';

describe('US country pack', () => {
  it('passes the shared contract checks', () => {
    expect(countryPackProblems(US)).toEqual([]);
  });

  it('has 50 states plus DC, each with one rate set and one nexus row', () => {
    expect(US.subdivisions).toHaveLength(51);
    expect(new Set(US.indirectTax.rateSets.map((s) => s.subdivision)).size).toBe(51);
    expect(US_ECONOMIC_NEXUS.map((r) => r.subdivision).sort()).toEqual(US.subdivisions!.map((s) => s.code).sort());
  });

  it('charges no state sales tax in AK, DE, MT, NH and OR', () => {
    for (const s of ['US-AK', 'US-DE', 'US-MT', 'US-NH', 'US-OR']) expect(usStateRate(s)).toBe(0);
    expect(usStateRate('US-CA')).toBe(7.25);
    expect(usStateRate('us-tx')).toBe(6.25);
  });
});

describe('EIN', () => {
  it('accepts assigned prefixes with or without the dash', () => {
    expect(validateEin('12-3456789')).toBe(true);
    expect(validateEin('993456789')).toBe(true);
  });

  it('rejects unassigned prefixes and wrong lengths', () => {
    for (const p of ['00', '07', '17', '28', '49', '69', '78', '89', '96', '97']) {
      expect(validateEin(`${p}-3456789`)).toBe(false);
    }
    expect(validateEin('12-345678')).toBe(false);
    expect(validateEin('')).toBe(false);
  });
});

describe('SSN and ITIN shape', () => {
  it('rejects reserved SSN areas, groups and serials', () => {
    expect(isSsnShape('123-45-6789')).toBe(true);
    expect(isSsnShape('000-45-6789')).toBe(false);
    expect(isSsnShape('666-45-6789')).toBe(false);
    expect(isSsnShape('923-45-6789')).toBe(false);
    expect(isSsnShape('123-00-6789')).toBe(false);
    expect(isSsnShape('123-45-0000')).toBe(false);
  });

  it('accepts ITIN middle digits only in the IRS ranges', () => {
    expect(isItinShape('900-70-0000')).toBe(true);
    expect(isItinShape('900-93-0000')).toBe(false);
    expect(isItinShape('900-66-0000')).toBe(false);
    expect(isItinShape('800-70-0000')).toBe(false);
  });
});

describe('ABA routing number', () => {
  it('accepts valid checksums', () => {
    expect(validateAbaRouting('011000015')).toBe(true); // Federal Reserve Bank of Boston
    expect(validateAbaRouting('021000021')).toBe(true);
  });

  it('rejects a wrong check digit, a bad prefix and wrong lengths', () => {
    expect(validateAbaRouting('011000016')).toBe(false);
    expect(validateAbaRouting('131000013')).toBe(false); // prefix 13 is not assigned
    expect(validateAbaRouting('01100001')).toBe(false);
    expect(validateAbaRouting('')).toBe(false);
  });

  it('validates routing plus account', () => {
    expect(validateUsAccount('011000015 123456789')).toBe(true);
    expect(validateUsAccount('011000015/12')).toBe(false);
    expect(validateUsAccount('011000016 123456789')).toBe(false);
  });
});

describe('US federal holidays', () => {
  it('lists 2026 with Independence Day observed on Friday 3 July', () => {
    expect(usFederalHolidays(2026)).toEqual([
      '2026-01-01',
      '2026-01-19',
      '2026-02-16',
      '2026-05-25',
      '2026-06-19',
      '2026-07-03',
      '2026-09-07',
      '2026-10-12',
      '2026-11-11',
      '2026-11-26',
      '2026-12-25',
    ]);
  });

  it('moves New Year 2028 (a Saturday) to 31 December 2027', () => {
    expect(usFederalHolidays(2027)).toContain('2027-12-31');
    expect(usFederalHolidays(2028)).not.toContain('2028-01-01');
    expect(usFederalHolidays(2028)).not.toContain('2027-12-31');
  });

  it('observes Sunday holidays on Monday (Juneteenth 2022) and has no Juneteenth before 2021', () => {
    expect(usFederalHolidays(2022)).toContain('2022-06-20');
    expect(usFederalHolidays(2020).some((d) => d.startsWith('2020-06-19'))).toBe(false);
  });
});

describe('US tax deadlines', () => {
  it('lists the 2026 quarterly estimates and shifts 1099-NEC off the weekend', () => {
    const d = US.deadlines!(2026);
    expect(d.filter((x) => x.kind === 'estimated_tax').map((x) => x.date)).toEqual([
      '2026-01-15',
      '2026-04-15',
      '2026-06-15',
      '2026-09-15',
    ]);
    // 31 January 2026 is a Saturday.
    expect(d.find((x) => x.kind === 'form_1099_nec')!.date).toBe('2026-02-02');
    // 15 March 2026 is a Sunday.
    expect(d.find((x) => x.kind === 'partnership_s_corp_return')!.date).toBe('2026-03-16');
  });

  it('skips DC Emancipation Day observed on Friday 15 April 2022, so returns were due on the 18th', () => {
    expect(nextIrsBusinessDay('2022-04-15')).toBe('2022-04-18');
    expect(nextIrsBusinessDay('2026-04-15')).toBe('2026-04-15');
  });
});

describe('economic nexus', () => {
  it('applies or, and and sales-only tests', () => {
    expect(reachesEconomicNexus('US-GA', 10_000, 200)).toBe(true);
    expect(reachesEconomicNexus('US-CT', 150_000, 10)).toBe(false);
    expect(reachesEconomicNexus('US-NY', 600_000, 101)).toBe(true);
    expect(reachesEconomicNexus('US-IL', 10_000, 5_000)).toBe(false);
    expect(reachesEconomicNexus('US-CA', 499_999, 0)).toBe(false);
    expect(reachesEconomicNexus('US-OR', 1_000_000, 1_000)).toBe(false);
  });
});
