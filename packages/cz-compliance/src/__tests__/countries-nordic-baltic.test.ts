import { describe, expect, it } from 'vitest';
import { countryPackProblems } from '../countries/contract.js';
import {
  DK,
  isValidCvr,
  isValidDkVat,
  isValidFik,
} from '../countries/dk/index.js';
import { EE, isValidEeReference, isValidEeVat, isValidRegistrikood, makeEeReference } from '../countries/ee/index.js';
import {
  FI,
  isValidFiReference,
  isValidFiVat,
  isValidYTunnus,
  makeFiReference,
  normalizeYTunnus,
} from '../countries/fi/index.js';
import { LT, LT_ISAF, isValidLtCompanyCode, isValidLtVat } from '../countries/lt/index.js';
import { LV, isValidLvPersonalCode, isValidLvRegNr, isValidLvVat } from '../countries/lv/index.js';
import {
  SE,
  isValidBankgiro,
  isValidOcrReference,
  isValidOrgNr,
  isValidSeVat,
  makeOcrReference,
  normalizeOrgNr,
} from '../countries/se/index.js';
import type { CountryPack } from '../countries/types.js';

const PACKS: CountryPack[] = [SE, DK, FI, EE, LV, LT];

const currentRates = (pack: CountryPack, on: string) =>
  [...pack.indirectTax.rateSets].reverse().find((s) => s.validFrom <= on)!.rates.map((r) => r.rate);

describe('Nordic and Baltic packs satisfy the contract', () => {
  it.each(PACKS.map((p) => [p.code, p] as const))('%s has no problems', (_code, pack) => {
    expect(countryPackProblems(pack)).toEqual([]);
  });

  it.each(PACKS.map((p) => [p.code, p] as const))('%s never uses the em dash', (_code, pack) => {
    const text = JSON.stringify(pack) + pack.holidays.toString();
    expect(text).not.toContain(String.fromCharCode(0x2014));
  });
});

describe('SE', () => {
  it('validates organisationsnummer with Luhn', () => {
    expect(isValidOrgNr('202100-5448')).toBe(true);
    expect(isValidOrgNr('2021005449')).toBe(false);
    expect(normalizeOrgNr('16202100-5448')).toBe('2021005448');
  });

  it('validates the VAT number SE + orgnr + 01', () => {
    expect(isValidSeVat('SE202100544801')).toBe(true);
    expect(isValidSeVat('SE202100544802')).toBe(false);
  });

  it('builds and checks OCR references, with and without the length digit', () => {
    const plain = makeOcrReference('12345');
    expect(isValidOcrReference(plain)).toBe(true);
    const withLen = makeOcrReference('12345', true);
    expect(withLen).toHaveLength(7);
    expect(isValidOcrReference(withLen, true)).toBe(true);
    expect(isValidOcrReference('1234')).toBe(false);
  });

  it('checks Bankgiro numbers with Luhn', () => {
    expect(isValidBankgiro('5050-1055')).toBe(true);
    expect(isValidBankgiro('5050-1056')).toBe(false);
  });

  it('cuts food VAT to 6 % from April 2026 to the end of 2027', () => {
    expect(currentRates(SE, '2026-03-31')).toEqual([25, 12, 6, 0]);
    expect(currentRates(SE, '2026-04-01')).toContain(6);
    expect(currentRates(SE, '2028-01-01')).toEqual(currentRates(SE, '2026-03-31'));
  });

  it('lists the 2026 holidays incl. Midsummer Eve', () => {
    expect(SE.holidays(2026)).toEqual([
      '2026-01-01', '2026-01-06', '2026-04-03', '2026-04-05', '2026-04-06', '2026-05-01',
      '2026-05-14', '2026-05-24', '2026-06-06', '2026-06-19', '2026-06-20', '2026-10-31',
      '2026-12-24', '2026-12-25', '2026-12-26', '2026-12-31',
    ]);
  });

  it('gives the summer extension to 17 August', () => {
    expect(SE.deadlines!(2026).some((d) => d.date === '2026-08-17')).toBe(true);
  });
});

describe('DK', () => {
  it('validates CVR with modulus 11', () => {
    expect(isValidCvr('13585628')).toBe(true);
    expect(isValidCvr('13585629')).toBe(false);
    expect(isValidCvr('03585628')).toBe(false);
    expect(isValidDkVat('DK 13 58 56 28')).toBe(true);
  });

  it('checks FIK payment IDs', () => {
    expect(isValidFik('+71<000000000012344+12345678<')).toBe(true);
    expect(isValidFik('+71<000000000012345+12345678<')).toBe(false);
    expect(isValidFik('+73<+12345678<')).toBe(true);
  });

  it('lists the 2026 holidays without Store Bededag', () => {
    expect(DK.holidays(2026)).toEqual([
      '2026-01-01', '2026-04-02', '2026-04-03', '2026-04-05', '2026-04-06', '2026-05-14',
      '2026-05-24', '2026-05-25', '2026-06-05', '2026-12-24', '2026-12-25', '2026-12-26', '2026-12-31',
    ]);
    expect(DK.holidays(2026)).not.toContain('2026-05-01');
  });
});

describe('FI', () => {
  it('validates Y-tunnus and pads old 6-digit IDs', () => {
    expect(isValidYTunnus('0112038-9')).toBe(true);
    expect(isValidYTunnus('0112038-8')).toBe(false);
    expect(normalizeYTunnus('1120389')).toBe('0112038-9');
    expect(isValidFiVat('FI01120389')).toBe(true);
    expect(isValidFiVat('FI01120388')).toBe(false);
  });

  it('rejects Y-tunnus bodies whose remainder is 1', () => {
    // Remainder 1 has no valid check digit; find such a body by brute force.
    for (let n = 0; n < 200; n++) {
      const body = String(n).padStart(7, '0');
      const w = [7, 9, 10, 5, 8, 4, 2];
      const r = w.reduce((s, x, i) => s + x * Number(body[i]), 0) % 11;
      if (r !== 1) continue;
      for (let c = 0; c <= 9; c++) expect(isValidYTunnus(`${body}-${c}`)).toBe(false);
      return;
    }
    throw new Error('no body with remainder 1 found');
  });

  it('builds and checks viitenumero with 7-3-1', () => {
    expect(makeFiReference('123')).toBe('1232');
    expect(isValidFiReference('1232')).toBe(true);
    expect(isValidFiReference('1233')).toBe(false);
    expect(isValidFiReference('12')).toBe(false);
  });

  it('follows the rate changes of 2024, 2025 and 2026', () => {
    expect(currentRates(FI, '2024-08-31')).toEqual([24, 14, 10, 0]);
    expect(currentRates(FI, '2024-09-01')[0]).toBe(25.5);
    expect(currentRates(FI, '2026-01-01')).toEqual([25.5, 13.5, 10, 0]);
  });

  it('lists the 2026 holidays incl. Midsummer and Independence Day', () => {
    expect(FI.holidays(2026)).toEqual([
      '2026-01-01', '2026-01-06', '2026-04-03', '2026-04-05', '2026-04-06', '2026-05-01',
      '2026-05-14', '2026-05-24', '2026-06-19', '2026-06-20', '2026-10-31', '2026-12-06',
      '2026-12-24', '2026-12-25', '2026-12-26',
    ]);
  });

  it('puts the annual return at the end of February, also in leap years', () => {
    const annual = (y: number) => FI.deadlines!(y).find((d) => d.kind === 'vat_return_annual')!.date;
    expect(annual(2028)).toBe('2028-02-29');
    // 28 Feb 2027 is a Sunday.
    expect(annual(2027)).toBe('2027-03-01');
  });
});

describe('EE', () => {
  it('validates registrikood incl. the second weight round', () => {
    expect(isValidRegistrikood('10137319')).toBe(true);
    expect(isValidRegistrikood('12345678')).toBe(true);
    expect(isValidRegistrikood('70000740')).toBe(true);
    expect(isValidRegistrikood('10137318')).toBe(false);
  });

  it('validates KMKR numbers', () => {
    expect(isValidEeVat('EE100931558')).toBe(true);
    expect(isValidEeVat('EE100931559')).toBe(false);
  });

  it('builds and checks viitenumber', () => {
    expect(makeEeReference('123')).toBe('1232');
    expect(isValidEeReference('1232')).toBe(true);
    expect(isValidEeReference('1231')).toBe(false);
  });

  it('raises the standard rate to 24 % from July 2025', () => {
    expect(currentRates(EE, '2025-06-30')[0]).toBe(22);
    expect(currentRates(EE, '2025-07-01')).toEqual([24, 13, 9, 0]);
  });

  it('lists the 2026 holidays', () => {
    expect(EE.holidays(2026)).toEqual([
      '2026-01-01', '2026-02-24', '2026-04-03', '2026-04-05', '2026-05-01', '2026-05-24',
      '2026-06-23', '2026-06-24', '2026-08-20', '2026-12-24', '2026-12-25', '2026-12-26',
    ]);
  });

  it('moves the December KMD from Sunday 20th to Monday', () => {
    expect(EE.deadlines!(2026).at(-1)!.date).toBe('2026-12-21');
  });
});

describe('LV', () => {
  it('validates legal entity numbers', () => {
    expect(isValidLvRegNr('40003521600')).toBe(true);
    expect(isValidLvRegNr('40003521601')).toBe(false);
    expect(isValidLvVat('LV40003521600')).toBe(true);
  });

  it('validates personal codes, new 32… codes without a checksum', () => {
    expect(isValidLvPersonalCode('16128312342')).toBe(true);
    expect(isValidLvPersonalCode('16128312341')).toBe(false);
    expect(isValidLvPersonalCode('32123456789')).toBe(true);
    expect(isValidLvVat('LV16128312342')).toBe(true);
  });

  it('applies the temporary 12 % on staple food only from July 2026 to June 2027', () => {
    const twelve = (on: string) =>
      [...LV.indirectTax.rateSets].reverse().find((s) => s.validFrom <= on)!.rates.find((r) => r.rate === 12)!
        .appliesTo;
    expect(twelve('2026-06-30')).not.toContain('bread');
    expect(twelve('2026-07-01')).toContain('bread');
    expect(twelve('2027-07-01')).not.toContain('bread');
  });

  it('lists the 2026 holidays', () => {
    expect(LV.holidays(2026)).toEqual([
      '2026-01-01', '2026-04-03', '2026-04-05', '2026-04-06', '2026-05-01', '2026-05-04',
      '2026-05-24', '2026-06-23', '2026-06-24', '2026-11-18', '2026-12-24', '2026-12-25',
      '2026-12-26', '2026-12-31',
    ]);
  });

  it('moves 4 May to Monday when it falls on a Sunday (2025)', () => {
    expect(LV.holidays(2025)).toContain('2025-05-05');
  });

  it('starts the B2B e-invoicing mandate in 2028', () => {
    expect(LV.einvoicing.find((m) => m.scope === 'b2b')!.from).toBe('2028-01-01');
  });
});

describe('LT', () => {
  it('validates company codes', () => {
    expect(isValidLtCompanyCode('188659752')).toBe(true);
    expect(isValidLtCompanyCode('188659753')).toBe(false);
  });

  it('validates PVM codes and the "1" marker digit', () => {
    expect(isValidLtVat('LT119511515')).toBe(true);
    expect(isValidLtVat('LT119511516')).toBe(false);
    expect(isValidLtVat('LT119511')).toBe(false);
  });

  it('abolishes the 9 % rate from 2026', () => {
    expect(currentRates(LT, '2025-12-31')).toEqual([21, 9, 5, 0]);
    expect(currentRates(LT, '2026-01-01')).toEqual([21, 12, 5, 0]);
  });

  it('lists the 2026 holidays incl. Mother’s and Father’s Day', () => {
    expect(LT.holidays(2026)).toEqual([
      '2026-01-01', '2026-02-16', '2026-03-11', '2026-04-05', '2026-04-06', '2026-05-01',
      '2026-05-03', '2026-06-07', '2026-06-24', '2026-07-06', '2026-08-15', '2026-11-01',
      '2026-11-02', '2026-12-24', '2026-12-25', '2026-12-26',
    ]);
  });

  it('has i.SAF on the 20th and the VAT return on the 25th, moved past Christmas', () => {
    const dec = LT.deadlines!(2026).filter((d) => d.date >= '2026-12-01');
    expect(dec.map((d) => [d.kind, d.date])).toEqual([
      ['isaf', '2026-12-21'],
      ['vat_return_monthly', '2026-12-28'],
    ]);
    expect(LT_ISAF.dueDay).toBe(20);
  });
});
