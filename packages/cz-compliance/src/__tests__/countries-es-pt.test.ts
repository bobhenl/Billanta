import { describe, expect, it } from 'vitest';
import { countryPackProblems } from '../countries/contract.js';
import { ES } from '../countries/es/index.js';
import { isValidDni, isValidEntityNif, isValidEsNif, isValidEsVatId, isValidKlmNif, isValidNie } from '../countries/es/tax-ids.js';
import { PT } from '../countries/pt/index.js';
import { isValidPtNif, isValidPtNipc, isValidPtVatId } from '../countries/pt/tax-ids.js';

describe.each([ES, PT])('$code pack contract', (pack) => {
  it('has no contract problems', () => {
    expect(countryPackProblems(pack)).toEqual([]);
  });

  it('never uses the em dash', () => {
    const text = JSON.stringify(pack);
    expect(text).not.toContain(String.fromCharCode(0x2014));
  });
});

describe('ES tax IDs', () => {
  it('validates DNI with the mod 23 letter', () => {
    expect(isValidDni('12345678Z')).toBe(true);
    expect(isValidDni('12345678-z')).toBe(true);
    expect(isValidDni('12345678A')).toBe(false);
    expect(isValidDni('00000000T')).toBe(true);
  });

  it('validates NIE with X/Y/Z as 0/1/2', () => {
    expect(isValidNie('X1234567L')).toBe(true);
    expect(isValidNie('Y1234567X')).toBe(true);
    expect(isValidNie('Z1234567R')).toBe(true);
    expect(isValidNie('X1234567A')).toBe(false);
  });

  it('validates entity NIFs with a digit or letter by legal form', () => {
    expect(isValidEntityNif('A58818501')).toBe(true);
    expect(isValidEntityNif('B12345674')).toBe(true);
    expect(isValidEntityNif('B12345675')).toBe(false);
    // P, Q, R, S, W, N require the control letter: 4 → D.
    expect(isValidEntityNif('Q1234567D')).toBe(true);
    expect(isValidEntityNif('Q12345674')).toBe(false);
    // A, B, E, H require the digit.
    expect(isValidEntityNif('B1234567D')).toBe(false);
    // C, D, F, G, J, U, V accept both.
    expect(isValidEntityNif('G12345674')).toBe(true);
    expect(isValidEntityNif('G1234567D')).toBe(true);
  });

  it('validates K/L/M NIFs and the combined NIF', () => {
    expect(isValidKlmNif('M1234567L')).toBe(true);
    expect(isValidEsNif('A58818501')).toBe(true);
    expect(isValidEsNif('X1234567L')).toBe(true);
    expect(isValidEsNif('')).toBe(false);
    expect(isValidEsNif('123456789')).toBe(false);
  });

  it('requires the ES prefix on the VAT number', () => {
    expect(isValidEsVatId('ES B12345674')).toBe(true);
    expect(isValidEsVatId('B12345674')).toBe(false);
  });
});

describe('PT tax IDs', () => {
  it('validates the mod 11 check digit', () => {
    expect(isValidPtNif('123456789')).toBe(true);
    expect(isValidPtNif('123 456 780')).toBe(false);
    expect(isValidPtNif('PT123456789')).toBe(true);
    // Check digit 10 is written as 0.
    expect(isValidPtNif('500000000')).toBe(true);
    // 4 alone is not a valid leading digit, 45 is.
    expect(isValidPtNif('400000002')).toBe(false);
    expect(isValidPtNif('12345678')).toBe(false);
  });

  it('accepts only entity prefixes as NIPC', () => {
    expect(isValidPtNipc('500000000')).toBe(true);
    expect(isValidPtNipc('123456789')).toBe(false);
  });

  it('requires the PT prefix on the VAT number', () => {
    expect(isValidPtVatId('PT 123 456 789')).toBe(true);
    expect(isValidPtVatId('123456789')).toBe(false);
  });
});

describe('ES rates and mandates', () => {
  it('keeps IGIC as a Canary Islands set', () => {
    const igic = ES.indirectTax.rateSets.find((s) => s.subdivision === 'ES-CN');
    expect(igic?.rates.find((r) => r.kind === 'standard')?.rate).toBe(7);
  });

  it('uses the RDL 15/2025 VERI*FACTU dates until a later one is in the BOE', () => {
    const vf = ES.einvoicing.filter((m) => m.platform?.startsWith('VERI*FACTU')).map((m) => m.from);
    expect(vf).toEqual(['2027-01-01', '2027-07-01']);
  });
});

describe('PT rates and numbering', () => {
  const current = (sub?: string) =>
    PT.indirectTax.rateSets.filter((s) => s.subdivision === sub).at(-1)!.rates.map((r) => r.rate);

  it('has mainland, Madeira and Azores rates', () => {
    expect(current()).toEqual([23, 13, 6, 0]);
    expect(current('PT-30')).toEqual([22, 12, 4]);
    expect(current('PT-20')).toEqual([16, 9, 4]);
  });

  it('requires series registration (ATCUD)', () => {
    expect(PT.invoice.numbering.seriesRegistration).toBe(true);
  });
});

describe('holidays 2026', () => {
  it('lists the Spanish national holidays', () => {
    expect(ES.holidays(2026)).toEqual([
      '2026-01-01',
      '2026-01-06',
      '2026-04-03',
      '2026-05-01',
      '2026-08-15',
      '2026-10-12',
      '2026-11-01',
      '2026-12-06',
      '2026-12-08',
      '2026-12-25',
    ]);
  });

  it('lists the Portuguese mandatory holidays', () => {
    expect(PT.holidays(2026)).toEqual([
      '2026-01-01',
      '2026-04-03',
      '2026-04-05',
      '2026-04-25',
      '2026-05-01',
      '2026-06-04',
      '2026-06-10',
      '2026-08-15',
      '2026-10-05',
      '2026-11-01',
      '2026-12-01',
      '2026-12-08',
      '2026-12-25',
    ]);
  });
});

describe('deadlines', () => {
  it('ES 303 dates in 2026 match the AEAT calendar', () => {
    const vat = ES.deadlines!(2026).filter((d) => d.kind === 'vat_return').map((d) => d.date);
    expect(vat).toEqual(['2026-01-30', '2026-04-20', '2026-07-20', '2026-10-20']);
  });

  it('ES moves a deadline on a weekend to Monday', () => {
    // 20 Jul 2025 is a Sunday.
    const q2 = ES.deadlines!(2025).find((d) => d.kind === 'vat_return' && d.title.en.includes('Q2'));
    expect(q2?.date).toBe('2025-07-21');
  });

  it('PT quarterly IVA return and payment in 2026', () => {
    const ret = PT.deadlines!(2026).filter((d) => d.kind === 'vat_return').map((d) => d.date);
    expect(ret).toEqual(['2026-02-20', '2026-05-20', '2026-08-20', '2026-11-20']);
    const pay = PT.deadlines!(2026).filter((d) => d.kind === 'vat_payment').map((d) => d.date);
    expect(pay).toEqual(['2026-02-25', '2026-05-25', '2026-08-25', '2026-11-25']);
  });

  it('PT moves a deadline on a weekend to Monday', () => {
    // 20 Feb 2027 is a Saturday.
    const q4 = PT.deadlines!(2027).find((d) => d.kind === 'vat_return');
    expect(q4?.date).toBe('2027-02-22');
  });
});
