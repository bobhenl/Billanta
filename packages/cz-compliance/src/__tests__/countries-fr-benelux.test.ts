import { describe, expect, it } from 'vitest';
import { countryPackProblems } from '../countries/contract.js';
import {
  BE,
  beDeadlines,
  beHolidays,
  beStructuredCommunication,
  formatBeEnterprise,
  parseBeStructuredCommunication,
  validateBeEnterprise,
  validateBeStructuredCommunication,
  validateBeVat,
} from '../countries/be/index.js';
import {
  FR,
  frDeadlines,
  frHolidays,
  frVatFromSiren,
  validateFrVat,
  validateSiren,
  validateSiret,
} from '../countries/fr/index.js';
import { LU, luHolidays, validateLuRcs, validateLuVat } from '../countries/lu/index.js';
import { NL, nlDeadlines, nlHolidays, validateKvk, validateNlVat } from '../countries/nl/index.js';

describe('FR/BE/NL/LU packs', () => {
  it.each([FR, BE, NL, LU])('$code passes the contract checks', (pack) => {
    expect(countryPackProblems(pack)).toEqual([]);
  });

  it('current rates are the last rate set', () => {
    const std = (p: typeof FR) => p.indirectTax.rateSets.at(-1)!.rates.find((r) => r.kind === 'standard')!.rate;
    expect([std(FR), std(BE), std(NL), std(LU)]).toEqual([20, 21, 21, 17]);
  });

  it('small-business notes', () => {
    expect(FR.indirectTax.smallBusiness?.invoiceNote.fr).toBe('TVA non applicable, art. 293 B du CGI');
    expect(BE.indirectTax.smallBusiness?.threshold).toBe(25_000);
    expect(NL.indirectTax.smallBusiness?.threshold).toBe(20_000);
    expect(LU.indirectTax.smallBusiness?.threshold).toBe(50_000);
  });

  it('BE uses structured communication, NL lists iDEAL', () => {
    expect(BE.payments.reference).toBe('be_structured');
    expect(NL.payments.localMethods).toContain('ideal');
  });

  it('mandates carry the key dates', () => {
    expect(FR.einvoicing.map((m) => m.from)).toEqual(['in_force', '2026-09-01', '2027-09-01', '2027-09-01']);
    expect(BE.einvoicing.find((m) => m.scope === 'b2b')?.from).toBe('2026-01-01');
  });
});

describe('FR identifiers', () => {
  it('SIREN uses Luhn', () => {
    expect(validateSiren('443 061 841')).toBe(true);
    expect(validateSiren('443061842')).toBe(false);
    expect(validateSiren('44306184')).toBe(false);
  });

  it('SIRET uses Luhn, with the La Poste exception', () => {
    expect(validateSiret('44306184100047')).toBe(true);
    expect(validateSiret('44306184100048')).toBe(false);
    // La Poste: head office passes Luhn, other establishments use digit sum mod 5.
    expect(validateSiret('35600000000048')).toBe(true);
    expect(validateSiret('35600000000010')).toBe(true);
    expect(validateSiret('35600000000049')).toBe(false);
  });

  it('VAT key is derived from the SIREN', () => {
    expect(frVatFromSiren('443061841')).toBe('FR64443061841');
    expect(validateFrVat('FR 64 443 061 841')).toBe(true);
    expect(validateFrVat('64443061841')).toBe(true);
    expect(validateFrVat('FR65443061841')).toBe(false);
    expect(validateFrVat('FRAB443061841')).toBe(true);
    expect(validateFrVat('FRIO443061841')).toBe(false);
    expect(frVatFromSiren('443061842')).toBeNull();
  });
});

describe('BE identifiers and structured communication', () => {
  it('enterprise number uses mod 97', () => {
    expect(validateBeEnterprise('0202.239.951')).toBe(true);
    expect(validateBeEnterprise('202239951')).toBe(true);
    expect(validateBeEnterprise('0202239952')).toBe(false);
    expect(validateBeEnterprise('2202239951')).toBe(false);
    expect(validateBeVat('BE 0202.239.951')).toBe(true);
    expect(validateBeVat('BE0202239950')).toBe(false);
    expect(formatBeEnterprise('BE0202239951')).toBe('0202.239.951');
  });

  it('builds the reference with mod 97 check digits', () => {
    expect(beStructuredCommunication(1234567890)).toBe('+++123/4567/89002+++');
    expect(beStructuredCommunication(42)).toBe('+++000/0000/04242+++');
    // Remainder 0 becomes 97.
    expect(beStructuredCommunication(97)).toBe('+++000/0000/09797+++');
    expect(() => beStructuredCommunication('12345678901')).toThrow(RangeError);
    expect(() => beStructuredCommunication('')).toThrow(RangeError);
  });

  it('round-trips through the validator', () => {
    for (const n of [1, 97, 2026_000_001, 9_999_999_999]) {
      const s = beStructuredCommunication(n);
      expect(validateBeStructuredCommunication(s)).toBe(true);
      expect(parseBeStructuredCommunication(s)!.slice(0, 10)).toBe(String(n).padStart(10, '0'));
    }
  });

  it('accepts stars and bare digits, rejects a wrong check', () => {
    expect(validateBeStructuredCommunication('***123/4567/89002***')).toBe(true);
    expect(validateBeStructuredCommunication('123456789002')).toBe(true);
    expect(validateBeStructuredCommunication('+++123/4567/89003+++')).toBe(false);
    expect(validateBeStructuredCommunication('+++123/4567/8900+++')).toBe(false);
  });
});

describe('NL identifiers', () => {
  it('accepts RSIN-based btw-ids (11-test)', () => {
    expect(validateNlVat('NL004495445B01')).toBe(true);
    expect(validateNlVat('NL004495446B01')).toBe(false);
  });

  it('accepts the post-2020 sole-trader btw-id (mod 97)', () => {
    expect(validateNlVat('NL000099998B57')).toBe(true);
    expect(validateNlVat('nl 0000 99998 b57')).toBe(true);
    expect(validateNlVat('NL000099998B58')).toBe(false);
    expect(validateNlVat('NL000099998X57')).toBe(false);
  });

  it('KvK is 8 digits', () => {
    expect(validateKvk('1234 5678')).toBe(true);
    expect(validateKvk('1234567')).toBe(false);
  });
});

describe('LU identifiers', () => {
  it('VAT uses mod 89', () => {
    expect(validateLuVat('LU15027442')).toBe(true);
    expect(validateLuVat('15027442')).toBe(true);
    expect(validateLuVat('LU15027443')).toBe(false);
  });

  it('RCS is a section letter plus digits', () => {
    expect(validateLuRcs('RCS Luxembourg B 12345')).toBe(true);
    expect(validateLuRcs('12345')).toBe(false);
  });
});

describe('2026 holidays', () => {
  // Easter Sunday 2026 is 5 April.
  it('FR', () => {
    expect(frHolidays(2026)).toEqual([
      '2026-01-01', '2026-04-06', '2026-05-01', '2026-05-08', '2026-05-14', '2026-05-25',
      '2026-07-14', '2026-08-15', '2026-11-01', '2026-11-11', '2026-12-25',
    ]);
  });

  it('BE', () => {
    expect(beHolidays(2026)).toEqual([
      '2026-01-01', '2026-04-06', '2026-05-01', '2026-05-14', '2026-05-25',
      '2026-07-21', '2026-08-15', '2026-11-01', '2026-11-11', '2026-12-25',
    ]);
  });

  it('NL', () => {
    expect(nlHolidays(2026)).toEqual([
      '2026-01-01', '2026-04-03', '2026-04-06', '2026-04-27', '2026-05-05',
      '2026-05-14', '2026-05-25', '2026-12-25', '2026-12-26',
    ]);
  });

  it('NL moves King\'s Day to 26 April when 27 April is a Sunday', () => {
    expect(nlHolidays(2025)).toContain('2025-04-26');
    expect(nlHolidays(2025)).not.toContain('2025-04-27');
  });

  it('LU', () => {
    expect(luHolidays(2026)).toEqual([
      '2026-01-01', '2026-04-06', '2026-05-01', '2026-05-09', '2026-05-14', '2026-05-25',
      '2026-06-23', '2026-08-15', '2026-11-01', '2026-12-25', '2026-12-26',
    ]);
  });
});

describe('deadlines', () => {
  it('FR CA12 is the 2nd working day after 1 May', () => {
    // 2026: 1 May Fri (holiday), Mon 4 May is the 1st working day.
    expect(frDeadlines(2026).find((d) => d.kind === 'vat_return_ca12')?.date).toBe('2026-05-05');
  });

  it('BE quarterly returns on the 25th', () => {
    expect(beDeadlines(2026).filter((d) => d.kind === 'vat_return_quarterly').map((d) => d.date)).toEqual([
      '2026-01-25', '2026-04-25', '2026-07-25', '2026-10-25',
    ]);
  });

  it('NL monthly returns at the end of the month, incl. leap February', () => {
    const feb = (y: number) =>
      nlDeadlines(y).find((d) => d.kind === 'vat_return_monthly' && d.date.startsWith(`${y}-02`))?.date;
    expect(feb(2026)).toBe('2026-02-28');
    expect(feb(2028)).toBe('2028-02-29');
  });
});
