import { describe, expect, it } from 'vitest';
import { countryPackProblems } from '../countries/contract.js';
import { DE } from '../countries/de/index.js';
import { isValidHandelsregister, isValidSteuernummer, isValidUstIdNr, normalizeUstIdNr } from '../countries/de/tax-ids.js';
import { AT } from '../countries/at/index.js';
import { isValidAtSteuernummer, isValidFirmenbuchnummer, isValidUid as isValidAtUid, normalizeUid as normalizeAtUid } from '../countries/at/tax-ids.js';
import { CH } from '../countries/ch/index.js';
import { isValidMwstNumber, isValidUid as isValidChUid, normalizeMwstNumber, normalizeUid as normalizeChUid } from '../countries/ch/tax-ids.js';
import { LI, isValidLiMwstNumber, isValidLiRegisterNumber } from '../countries/li/index.js';

const rateOn = (pack: typeof DE, date: string) =>
  [...pack.indirectTax.rateSets].reverse().find((set) => set.validFrom <= date)!.rates.map((r) => r.rate);

describe('DACH country packs', () => {
  it.each([DE, AT, CH, LI])('$code passes the contract checks', (pack) => {
    expect(countryPackProblems(pack)).toEqual([]);
  });
});

describe('DE', () => {
  it('validates the USt-IdNr check digit (ISO 7064 MOD 11,10)', () => {
    expect(isValidUstIdNr('DE136695976')).toBe(true);
    expect(isValidUstIdNr('de 136 695 976')).toBe(true);
    expect(isValidUstIdNr('DE136695977')).toBe(false);
    expect(isValidUstIdNr('DE036695976')).toBe(false);
    expect(isValidUstIdNr('DE13669597')).toBe(false);
    expect(normalizeUstIdNr('136 695 976')).toBe('DE136695976');
  });

  it('accepts Steuernummer in the Länder and ELSTER formats', () => {
    expect(isValidSteuernummer('21/815/08150')).toBe(true);
    expect(isValidSteuernummer('181/815/08155')).toBe(true);
    expect(isValidSteuernummer('2181508150')).toBe(true);
    expect(isValidSteuernummer('1121081508150')).toBe(true);
    expect(isValidSteuernummer('21/81/508150')).toBe(false);
    expect(isValidSteuernummer('12345')).toBe(false);
  });

  it('accepts Handelsregister numbers', () => {
    expect(isValidHandelsregister('HRB 12345')).toBe(true);
    expect(isValidHandelsregister('HRA 1 B')).toBe(true);
    expect(isValidHandelsregister('XYZ 12345')).toBe(false);
  });

  it('lists the nationwide 2026 holidays', () => {
    expect(DE.holidays(2026)).toEqual([
      '2026-01-01', '2026-04-03', '2026-04-06', '2026-05-01', '2026-05-14',
      '2026-05-25', '2026-10-03', '2026-12-25', '2026-12-26',
    ]);
  });

  it('moves a deadline on a weekend to the next working day (§ 108 Abs. 3 AO)', () => {
    const monthly = DE.deadlines!(2026).filter((d) => d.kind === 'vat_return_monthly').map((d) => d.date);
    // 10 Jan 2026 is a Saturday, 10 May a Sunday.
    expect(monthly[0]).toBe('2026-01-12');
    expect(monthly[4]).toBe('2026-05-11');
    expect(monthly[1]).toBe('2026-02-10');
  });

  it('keeps the rate history', () => {
    expect(rateOn(DE, '2020-08-01')).toEqual([16, 5]);
    expect(rateOn(DE, '2026-03-01')).toEqual([19, 7, 0]);
  });

  it('has the B2B e-invoice timeline', () => {
    expect(DE.einvoicing.map((m) => `${m.scope}:${m.from}`)).toEqual(
      expect.arrayContaining(['b2b:2025-01-01', 'b2b:2027-01-01', 'b2b:2028-01-01']),
    );
  });
});

describe('AT', () => {
  it('validates the UID check digit', () => {
    expect(isValidAtUid('ATU13585627')).toBe(true);
    expect(isValidAtUid('atu 1358 5627')).toBe(true);
    expect(isValidAtUid('ATU13585628')).toBe(false);
    expect(isValidAtUid('AT13585627')).toBe(false);
    expect(normalizeAtUid('U13585627')).toBe('ATU13585627');
  });

  it('checks Steuernummer and Firmenbuchnummer formats', () => {
    expect(isValidAtSteuernummer('12 345/6789')).toBe(true);
    expect(isValidAtSteuernummer('12 345/678')).toBe(false);
    expect(isValidFirmenbuchnummer('FN 123456a')).toBe(true);
    expect(isValidFirmenbuchnummer('FN 123456')).toBe(false);
  });

  it('lists the 2026 holidays', () => {
    expect(AT.holidays(2026)).toEqual([
      '2026-01-01', '2026-01-06', '2026-04-06', '2026-05-01', '2026-05-14', '2026-05-25',
      '2026-06-04', '2026-08-15', '2026-10-26', '2026-11-01', '2026-12-08', '2026-12-25', '2026-12-26',
    ]);
  });

  it('moves deadlines past weekends (§ 108 Abs. 3 BAO)', () => {
    const quarterly = AT.deadlines!(2026).filter((d) => d.kind === 'vat_return_quarterly').map((d) => d.date);
    // 15 Feb and 15 Nov 2026 are Sundays, 15 Aug a Saturday.
    expect(quarterly).toEqual(['2026-02-16', '2026-05-15', '2026-08-17', '2026-11-16']);
  });

  it('adds the 4.9 % staple-food rate from July 2026', () => {
    expect(rateOn(AT, '2026-06-30')).toEqual([20, 13, 10]);
    expect(rateOn(AT, '2026-07-01')).toContain(4.9);
    expect(AT.indirectTax.smallBusiness?.threshold).toBe(55_000);
  });
});

describe('CH', () => {
  it('validates the UID check digit (mod 11)', () => {
    expect(isValidChUid('CHE-123.456.788')).toBe(true);
    expect(isValidChUid('CHE123456788')).toBe(true);
    expect(isValidChUid('CHE-123.456.789')).toBe(false);
    expect(isValidChUid('123.456.788')).toBe(false);
    expect(normalizeChUid('che123456788')).toBe('CHE-123.456.788');
  });

  it('validates MWST numbers with the language suffix', () => {
    expect(isValidMwstNumber('CHE-123.456.788 MWST')).toBe(true);
    expect(isValidMwstNumber('CHE-123.456.788 TVA')).toBe(true);
    expect(isValidMwstNumber('CHE-123.456.787 MWST')).toBe(false);
    expect(normalizeMwstNumber('CHE123456788IVA')).toBe('CHE-123.456.788 IVA');
  });

  it('lists the four holidays observed everywhere in 2026', () => {
    expect(CH.holidays(2026)).toEqual(['2026-01-01', '2026-05-14', '2026-08-01', '2026-12-25']);
  });

  it('files 60 days after the quarter, moved to a working day', () => {
    const quarterly = CH.deadlines!(2026).filter((d) => d.kind === 'vat_return_quarterly').map((d) => d.date);
    // Q4 2025 → 1 Mar 2026 (Sunday) → 2 Mar; Q1 → 30 May (Saturday) → 1 Jun.
    expect(quarterly.slice(0, 2)).toEqual(['2026-03-02', '2026-06-01']);
  });

  it('uses the 2024 rates, the QR-bill and 5-Rappen rounding', () => {
    expect(rateOn(CH, '2023-12-31')).toEqual([7.7, 2.5, 3.7]);
    expect(rateOn(CH, '2026-01-01')).toEqual([8.1, 2.6, 3.8]);
    expect(CH.payments.qr).toEqual(['swiss_qr']);
    expect(CH.cashRounding).toBe(0.05);
  });
});

describe('LI', () => {
  it('follows the Swiss rates and currency', () => {
    expect(LI.indirectTax.rateSets).toBe(CH.indirectTax.rateSets);
    expect(LI.currency).toBe('CHF');
  });

  it('checks the MWST and register number formats', () => {
    expect(isValidLiMwstNumber('12345')).toBe(true);
    expect(isValidLiMwstNumber('FL 123456 MWST')).toBe(true);
    expect(isValidLiMwstNumber('1234')).toBe(false);
    expect(isValidLiRegisterNumber('FL-0002.123.456-7')).toBe(true);
    expect(isValidLiRegisterNumber('FL-0002.123.456')).toBe(false);
  });

  it('lists the 2026 Sunday-equivalent holidays', () => {
    expect(LI.holidays(2026)).toEqual([
      '2026-01-01', '2026-01-06', '2026-04-06', '2026-05-01', '2026-05-14', '2026-05-25',
      '2026-06-04', '2026-08-15', '2026-09-08', '2026-11-01', '2026-12-08', '2026-12-25', '2026-12-26',
    ]);
  });
});
