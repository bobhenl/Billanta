import { describe, expect, it } from 'vitest';
import { countryPackProblems } from '../countries/contract.js';
import { AE } from '../countries/ae/index.js';
import { isValidTrn, normalizeTrn, tinFromTrn } from '../countries/ae/trn.js';
import { BH, isValidBhVat, normalizeBhVat } from '../countries/bh/index.js';
import { OM, isValidOmVat, normalizeOmVat } from '../countries/om/index.js';
import { QA } from '../countries/qa/index.js';
import { SA } from '../countries/sa/index.js';
import { isValidCrn, isValidSaVat, normalizeCrn, normalizeSaVat } from '../countries/sa/tax-ids.js';

const PACKS = [AE, SA, QA, BH, OM];

describe('Gulf country packs', () => {
  it.each(PACKS.map((p) => [p.code, p] as const))('%s passes the contract checks', (_code, pack) => {
    expect(countryPackProblems(pack)).toEqual([]);
  });

  it('uses Arabic and English and the right minor units', () => {
    for (const p of PACKS) expect(p.locales).toEqual(['ar', 'en']);
    expect(BH.currencyMinorUnits).toBe(3);
    expect(OM.currencyMinorUnits).toBe(3);
    expect(AE.currencyMinorUnits).toBe(2);
  });

  it('has the current standard VAT rates and none in Qatar', () => {
    const standard = (p: typeof AE) => p.indirectTax.rateSets.at(-1)?.rates.find((r) => r.kind === 'standard')?.rate;
    expect(standard(AE)).toBe(5);
    expect(standard(SA)).toBe(15);
    expect(standard(BH)).toBe(10);
    expect(standard(OM)).toBe(5);
    expect(QA.indirectTax.kind).toBe('none');
    expect(QA.indirectTax.rateSets).toEqual([]);
  });

  it('keeps the Bahrain 5 % history before 2022', () => {
    expect(BH.indirectTax.rateSets.map((s) => s.validFrom)).toEqual(['2019-01-01', '2022-01-01']);
  });

  it('requires Arabic on Saudi and Omani invoices but not in the UAE', () => {
    expect(SA.invoice.language?.required).toEqual(['ar']);
    expect(OM.invoice.language?.required).toEqual(['ar']);
    expect(AE.invoice.language?.required ?? []).not.toContain('ar');
  });
});

describe('UAE TRN', () => {
  it('accepts 15 digits with separators and an AE prefix', () => {
    expect(isValidTrn(normalizeTrn('100-1234-5670-0003'))).toBe(true);
    expect(isValidTrn(normalizeTrn('AE100123456700003'))).toBe(true);
  });

  it('rejects 14 or 16 digits and letters', () => {
    expect(isValidTrn('10012345670000')).toBe(false);
    expect(isValidTrn('1001234567000030')).toBe(false);
    expect(isValidTrn('10012345670000A')).toBe(false);
  });

  it('derives the 10-digit TIN', () => {
    expect(tinFromTrn('100123456700003')).toBe('1001234567');
    expect(tinFromTrn('123')).toBeNull();
  });
});

describe('Saudi VAT number and CRN', () => {
  it('needs 15 digits starting and ending with 3', () => {
    expect(isValidSaVat(normalizeSaVat('310122393500003'))).toBe(true);
    expect(isValidSaVat(normalizeSaVat('SA 310 122 393 500 003'))).toBe(true);
    expect(isValidSaVat('210122393500003')).toBe(false);
    expect(isValidSaVat('310122393500002')).toBe(false);
    expect(isValidSaVat('31012239350003')).toBe(false);
  });

  it('takes a 10-digit commercial registration number', () => {
    expect(isValidCrn(normalizeCrn('1010 010 000'))).toBe(true);
    expect(isValidCrn('101001000')).toBe(false);
  });
});

describe('Bahrain and Oman VAT numbers', () => {
  it('Bahrain: 15 digits', () => {
    expect(isValidBhVat(normalizeBhVat('2000-1234-5600-002'))).toBe(true);
    expect(isValidBhVat(normalizeBhVat('BH200012345600002'))).toBe(true);
    expect(isValidBhVat('20001234560000')).toBe(false);
  });

  it('Oman: OM plus 10 digits, and a bare number gets the prefix', () => {
    expect(normalizeOmVat('1100012345')).toBe('OM1100012345');
    expect(isValidOmVat(normalizeOmVat('om 1100012345'))).toBe(true);
    expect(isValidOmVat('OM110001234')).toBe(false);
    expect(isValidOmVat('1100012345')).toBe(false);
  });

  it('Qatar TIN: 10 digits', () => {
    const tin = QA.taxIds[0]!;
    expect(tin.validate(tin.normalize('5000 012 345'))).toBe(true);
    expect(tin.validate('500001234')).toBe(false);
  });
});

describe('Gulf holidays', () => {
  it('UAE 2027 includes National Day and the estimated Eid al-Fitr', () => {
    const h = AE.holidays(2027);
    expect(h).toContain('2027-12-02');
    expect(h).toContain('2027-03-09');
    expect(h).toEqual([...h].sort());
  });

  it('Saudi Founding Day and National Day are fixed', () => {
    expect(SA.holidays(2026)).toEqual(expect.arrayContaining(['2026-02-22', '2026-09-23']));
  });

  it('Qatar National Sport Day is the second Tuesday of February', () => {
    expect(QA.holidays(2026)).toContain('2026-02-10');
    expect(QA.holidays(2027)).toContain('2027-02-09');
  });

  it('Oman Eid al-Fitr starts the day before the estimate', () => {
    expect(OM.holidays(2026)).toContain('2026-03-19');
  });

  it('outside the Hijri table only fixed dates remain', () => {
    expect(AE.holidays(2030)).toEqual(['2030-01-01', '2030-12-02', '2030-12-03']);
    expect(BH.holidays(2030)).toEqual(['2030-01-01', '2030-05-01', '2030-12-16', '2030-12-17']);
  });
});

describe('Gulf deadlines', () => {
  it('UAE VAT return is due 28 days after the period', () => {
    const vat = (AE.deadlines?.(2026) ?? []).filter((d) => d.kind.startsWith('vat'));
    expect(vat.map((d) => d.date)).toContain('2026-01-28');
  });

  it('Bahrain monthly returns fall on the last day of the month, leap years included', () => {
    const dates = (BH.deadlines?.(2028) ?? []).map((d) => d.date);
    expect(dates).toContain('2028-02-29');
  });
});
