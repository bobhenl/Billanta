import { describe, expect, it } from 'vitest';
import { countryPackProblems } from '../countries/contract.js';
import {
  GB,
  isNorthernIrelandVatNumber,
  isValidCompanyNumber,
  isValidUkBankAccount,
  isValidUkVatNumber,
  normalizeCompanyNumber,
  ukBankHolidays,
  ukDeadlines,
  ukVatReturnDue,
} from '../countries/gb/index.js';
import { IE, ieDeadlines, ieHolidays, isValidCroNumber, isValidIeVatNumber } from '../countries/ie/index.js';
import { IS, isCompanyKennitala, isDeadlines, isHolidays, isValidIsBankAccount, isValidKennitala } from '../countries/is/index.js';
import { NO, formatNoVatNumber, isValidNoBankAccount, isValidOrgNumber, noDeadlines, noHolidays } from '../countries/no/index.js';

describe('GB / IE / NO / IS country packs', () => {
  it.each([GB, IE, NO, IS])('$code passes the contract checks', (pack) => {
    expect(countryPackProblems(pack)).toEqual([]);
  });
});

describe('United Kingdom', () => {
  it('validates VAT numbers with mod 97 and the 9755 variant', () => {
    expect(isValidUkVatNumber('GB 999 9999 73')).toBe(true);
    expect(isValidUkVatNumber('123456782')).toBe(true); // mod 97
    expect(isValidUkVatNumber('123456727')).toBe(true); // 9755
    expect(isValidUkVatNumber('GB999999973001')).toBe(true); // branch suffix
    expect(isValidUkVatNumber('XI 999 9999 73')).toBe(true);
    expect(isValidUkVatNumber('GB999999974')).toBe(false);
    expect(isValidUkVatNumber('GBGD001')).toBe(true);
    expect(isValidUkVatNumber('GBGD500')).toBe(false);
    expect(isValidUkVatNumber('GBHA500')).toBe(true);
    expect(isValidUkVatNumber('')).toBe(false);
  });

  it('flags Northern Ireland XI numbers', () => {
    expect(isNorthernIrelandVatNumber('XI999999973')).toBe(true);
    expect(isNorthernIrelandVatNumber('GB999999973')).toBe(false);
  });

  it('validates Companies House numbers and pads short ones', () => {
    expect(normalizeCompanyNumber('445790')).toBe('00445790');
    expect(isValidCompanyNumber('00445790')).toBe(true);
    expect(isValidCompanyNumber('SC123456')).toBe(true);
    expect(isValidCompanyNumber('NI123456')).toBe(true);
    expect(isValidCompanyNumber('ABC12345')).toBe(false);
  });

  it('accepts a sort code plus an 8-digit account', () => {
    expect(isValidUkBankAccount('20-00-00 55779911')).toBe(true);
    expect(isValidUkBankAccount('200000 5577991')).toBe(false);
  });

  it('lists the 2026 bank holidays per nation, with substitute days', () => {
    expect(ukBankHolidays(2026)).toEqual([
      '2026-01-01', '2026-04-03', '2026-04-06', '2026-05-04', '2026-05-25', '2026-08-31', '2026-12-25', '2026-12-28',
    ]);
    expect(ukBankHolidays(2026, 'GB-SCT')).toEqual([
      '2026-01-01', '2026-01-02', '2026-04-03', '2026-05-04', '2026-05-25', '2026-08-03', '2026-11-30', '2026-12-25', '2026-12-28',
    ]);
    // 12 July 2026 is a Sunday, so the Battle of the Boyne holiday moves to Monday 13 July.
    expect(ukBankHolidays(2026, 'GB-NIR')).toEqual([
      '2026-01-01', '2026-03-17', '2026-04-03', '2026-04-06', '2026-05-04', '2026-05-25', '2026-07-13', '2026-08-31', '2026-12-25', '2026-12-28',
    ]);
  });

  it('puts VAT returns one month and seven days after the period and Self Assessment on 31 January', () => {
    expect(ukVatReturnDue('2026-03-31')).toBe('2026-05-07');
    expect(ukVatReturnDue('2026-12-31')).toBe('2027-02-07');
    const dates = ukDeadlines(2026).map((d) => `${d.date} ${d.kind}`);
    expect(dates).toContain('2026-01-31 self_assessment');
    expect(dates).toContain('2026-05-07 vat_return');
  });
});

describe('Ireland', () => {
  it('validates VAT numbers in the old, current and two-letter formats', () => {
    expect(isValidIeVatNumber('IE 6433435F')).toBe(true);
    expect(isValidIeVatNumber('3628739UA')).toBe(true);
    expect(isValidIeVatNumber('8Z49289F')).toBe(true);
    expect(isValidIeVatNumber('6433435G')).toBe(false);
    expect(isValidIeVatNumber('3628739UB')).toBe(false);
    expect(isValidIeVatNumber('')).toBe(false);
  });

  it('accepts CRO numbers as plain sequence numbers', () => {
    expect(isValidCroNumber('123456')).toBe(true);
    expect(isValidCroNumber('0')).toBe(false);
    expect(isValidCroNumber('12A456')).toBe(false);
  });

  it('lists the 2026 public holidays, St Brigid’s Day included', () => {
    expect(ieHolidays(2026)).toEqual([
      '2026-01-01', '2026-02-02', '2026-03-17', '2026-04-06', '2026-05-04', '2026-06-01', '2026-08-03', '2026-10-26', '2026-12-25', '2026-12-26',
    ]);
    // 1 February 2030 is a Friday, so St Brigid's Day stays on it.
    expect(ieHolidays(2030)).toContain('2030-02-01');
  });

  it('puts bi-monthly VAT3 ROS returns on the 23rd', () => {
    const vat = ieDeadlines(2026).filter((d) => d.kind === 'vat_return').map((d) => d.date);
    expect(vat).toEqual(['2026-01-23', '2026-03-23', '2026-05-23', '2026-07-23', '2026-09-23', '2026-11-23']);
  });

  it('switches restaurants and hairdressing to 9% from July 2026', () => {
    expect(IE.indirectTax.rateSets.at(-1)?.validFrom).toBe('2026-07-01');
  });
});

describe('Norway', () => {
  it('validates organisation numbers and formats the MVA number', () => {
    expect(isValidOrgNumber('923 609 016')).toBe(true);
    expect(isValidOrgNumber('NO 923609016 MVA')).toBe(true);
    expect(isValidOrgNumber('923609017')).toBe(false);
    expect(isValidOrgNumber('123609016')).toBe(false);
    expect(formatNoVatNumber('923609016')).toBe('NO 923 609 016 MVA');
  });

  it('checks the mod 11 digit of domestic bank accounts', () => {
    expect(isValidNoBankAccount('8601 11 17947')).toBe(true);
    expect(isValidNoBankAccount('8601 11 17948')).toBe(false);
    expect(isValidNoBankAccount('8601 11 1794')).toBe(false);
  });

  it('lists the 2026 public holidays', () => {
    expect(noHolidays(2026)).toEqual([
      '2026-01-01', '2026-04-02', '2026-04-03', '2026-04-05', '2026-04-06', '2026-05-01', '2026-05-14', '2026-05-17',
      '2026-05-24', '2026-05-25', '2026-12-25', '2026-12-26',
    ]);
  });

  it('moves MVA deadlines off weekends', () => {
    const vat = noDeadlines(2026).filter((d) => d.kind === 'vat_return').map((d) => d.date);
    // 10 October 2026 is a Saturday.
    expect(vat).toEqual(['2026-02-10', '2026-04-10', '2026-06-10', '2026-08-31', '2026-10-12', '2026-12-10']);
    // 31 May 2026 is a Sunday.
    expect(noDeadlines(2026).find((d) => d.kind === 'income_tax')?.date).toBe('2026-06-01');
  });
});

describe('Iceland', () => {
  it('validates the kennitala and tells companies apart', () => {
    expect(isValidKennitala('491008-0160')).toBe(true);
    expect(isCompanyKennitala('4910080160')).toBe(true);
    expect(isValidKennitala('4910080170')).toBe(false);
    expect(isValidKennitala('4913080160')).toBe(false);
    expect(isValidKennitala('')).toBe(false);
  });

  it('accepts 12-digit accounts, optionally followed by a valid kennitala', () => {
    expect(isValidIsBankAccount('0133-26-012345')).toBe(true);
    expect(isValidIsBankAccount('0133-26-012345 491008-0160')).toBe(true);
    expect(isValidIsBankAccount('0133-26-012345 491008-0170')).toBe(false);
  });

  it('lists the 2026 public holidays', () => {
    expect(isHolidays(2026)).toEqual([
      '2026-01-01', '2026-04-02', '2026-04-03', '2026-04-05', '2026-04-06', '2026-04-23', '2026-05-01', '2026-05-14',
      '2026-05-24', '2026-05-25', '2026-06-17', '2026-08-03', '2026-12-24', '2026-12-25', '2026-12-26', '2026-12-31',
    ]);
  });

  it('puts VAT on the 5th of the second month, moved to the next business day', () => {
    // 5 April is Easter Sunday and 6 April Easter Monday; 5 December is a Saturday.
    expect(isDeadlines(2026).map((d) => d.date)).toEqual([
      '2026-02-05', '2026-04-07', '2026-06-05', '2026-08-05', '2026-10-05', '2026-12-07',
    ]);
  });

  it('uses ISK without decimals', () => {
    expect(IS.currencyMinorUnits).toBe(0);
  });
});
