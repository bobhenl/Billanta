import { describe, expect, it } from 'vitest';
import { countryPackProblems } from '../countries/contract.js';
import { HK } from '../countries/hk/index.js';
import { isValidHkBrNumber } from '../countries/hk/tax-ids.js';
import { JP } from '../countries/jp/index.js';
import { jpDeadlines, jpHolidays } from '../countries/jp/dates.js';
import { isValidJpBankAccount, isValidJpCorporateNumber, isValidJpInvoiceRegistrationNumber } from '../countries/jp/tax-ids.js';
import { TH } from '../countries/th/index.js';
import { thDeadlines, thHolidays } from '../countries/th/dates.js';
import { isValidThBankAccount, isValidThTaxId } from '../countries/th/tax-ids.js';

describe.each([TH, JP, HK])('$code pack', (pack) => {
  it('passes the contract checks', () => {
    expect(countryPackProblems(pack)).toEqual([]);
  });

  it('has holidays for 2027 inside the year', () => {
    const days = pack.holidays(2027);
    expect(days.length).toBeGreaterThan(5);
    for (const d of days) expect(d.startsWith('2027-')).toBe(true);
  });

  it('never uses the em dash', () => {
    expect(JSON.stringify(pack)).not.toContain(String.fromCharCode(0x2014));
  });
});

describe('TH', () => {
  it('validates the 13-digit tax ID check digit', () => {
    expect(isValidThTaxId('0107544000108')).toBe(true);
    expect(isValidThTaxId('0-1075-44000-10-8')).toBe(true);
    expect(isValidThTaxId('0107544000109')).toBe(false);
    expect(isValidThTaxId('010754400010')).toBe(false);
    expect(isValidThTaxId('')).toBe(false);
  });

  it('accepts 10- and 12-digit bank accounts only', () => {
    expect(isValidThBankAccount('123-4-56789-0')).toBe(true);
    expect(isValidThBankAccount('123456789012')).toBe(true);
    expect(isValidThBankAccount('12345678901')).toBe(false);
  });

  it('uses 7 % VAT and the tax invoice title', () => {
    const current = TH.indirectTax.rateSets.at(-1)!;
    expect(current.rates.find((r) => r.kind === 'standard')?.rate).toBe(7);
    expect(TH.invoice.title?.standard.th).toBe('ใบกำกับภาษี');
    expect(TH.indirectTax.smallBusiness?.threshold).toBe(1_800_000);
    expect(TH.payments.qr).toContain('promptpay');
  });

  it('lists the Bank of Thailand holidays incl. lunar substitutes', () => {
    const y2026 = thHolidays(2026);
    expect(y2026).toContain('2026-03-03'); // Makha Bucha
    expect(y2026).toContain('2026-06-01'); // Visakha Bucha on Sunday 31 May, moved
    expect(y2026).not.toContain('2026-10-16'); // Bangkok only
    expect(thHolidays(2027)).toContain('2027-02-22');
    // Unpublished year: solar dates only.
    expect(thHolidays(2030)).toContain('2030-04-13');
  });

  it('puts P.P.30 on the 15th and the 23rd', () => {
    const vat = thDeadlines(2026).filter((d) => d.kind.startsWith('vat_return'));
    expect(vat).toHaveLength(24);
    expect(vat.map((d) => d.date)).toContain('2026-11-23');
  });
});

describe('JP', () => {
  it('validates the corporate number check digit', () => {
    expect(isValidJpCorporateNumber('7000012050002')).toBe(true);
    expect(isValidJpCorporateNumber('2010001008824')).toBe(true);
    expect(isValidJpCorporateNumber('8000012050002')).toBe(false);
    expect(isValidJpCorporateNumber('700001205000')).toBe(false);
  });

  it('validates the qualified invoice registration number', () => {
    expect(isValidJpInvoiceRegistrationNumber('T7000012050002')).toBe(true);
    expect(isValidJpInvoiceRegistrationNumber('t7000-0120-50002')).toBe(true);
    expect(isValidJpInvoiceRegistrationNumber('7000012050002')).toBe(false);
    expect(isValidJpInvoiceRegistrationNumber('T8000012050002')).toBe(false);
  });

  it('validates a zengin account', () => {
    expect(isValidJpBankAccount('0001-001-1234567')).toBe(true);
    expect(isValidJpBankAccount('0001-001-123456')).toBe(false);
  });

  it('has 10 % and the reduced 8 % and no yen decimals', () => {
    const rates = JP.indirectTax.rateSets.at(-1)!.rates.map((r) => r.rate);
    expect(rates).toEqual([10, 8, 0]);
    expect(JP.currencyMinorUnits).toBe(0);
    expect(JP.indirectTax.smallBusiness?.threshold).toBe(10_000_000);
  });

  it('computes 2026 holidays with the substitute and citizens’ holidays', () => {
    expect(jpHolidays(2026)).toEqual([
      '2026-01-01', '2026-01-12', '2026-02-11', '2026-02-23', '2026-03-20', '2026-04-29',
      '2026-05-03', '2026-05-04', '2026-05-05', '2026-05-06', '2026-07-20', '2026-08-11',
      '2026-09-21', '2026-09-22', '2026-09-23', '2026-10-12', '2026-11-03', '2026-11-23',
    ]);
  });

  it('moves the 2027 vernal equinox off Sunday', () => {
    const y = jpHolidays(2027);
    expect(y).toContain('2027-03-21');
    expect(y).toContain('2027-03-22');
    expect(y).toContain('2027-09-23');
    expect(y).not.toContain('2027-09-22');
  });

  it('moves deadlines off weekends', () => {
    const d2026 = Object.fromEntries(jpDeadlines(2026).map((d) => [d.kind, d.date]));
    expect(d2026.income_tax_individual).toBe('2026-03-16'); // 15 March is a Sunday
    expect(d2026.consumption_tax_individual).toBe('2026-03-31');
    expect(d2026.corporate_tax_march_fy).toBe('2026-06-01'); // 31 May is a Sunday
    const d2027 = Object.fromEntries(jpDeadlines(2027).map((d) => [d.kind, d.date]));
    expect(d2027.income_tax_individual).toBe('2027-03-15');
  });
});

describe('HK', () => {
  it('checks the BR number shape', () => {
    expect(isValidHkBrNumber('12345678')).toBe(true);
    expect(isValidHkBrNumber('12345678-000')).toBe(true);
    expect(isValidHkBrNumber('12345678-000-07-26-a')).toBe(true);
    expect(isValidHkBrNumber('1234567')).toBe(false);
    expect(isValidHkBrNumber('12345678-00')).toBe(false);
  });

  it('has no indirect tax', () => {
    expect(HK.indirectTax.kind).toBe('none');
    expect(HK.indirectTax.rateSets).toHaveLength(0);
    expect(HK.payments.qr).toEqual(['fps']);
  });

  it('lists gazetted holidays and falls back to Easter-based ones', () => {
    expect(HK.holidays(2026)).toContain('2026-02-17');
    expect(HK.holidays(2027)).toContain('2027-12-27');
    // Easter 2030 is 21 April.
    expect(HK.holidays(2030)).toEqual(expect.arrayContaining(['2030-04-19', '2030-04-20', '2030-04-22']));
  });
});
