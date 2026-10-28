import { describe, expect, it } from 'vitest';
import { countryPackProblems } from '../countries/contract.js';
import {
  IT,
  isValidItCodiceFiscale,
  isValidItPartitaIva,
  itCodiceFiscaleCheckChar,
  italyDeadlineDate,
  italyDeadlines,
  italyHolidays,
  italyStampDutyDue,
  normalizeItVat,
} from '../countries/it/index.js';
import { MT, isValidMtVat, maltaDeadlines, maltaHolidays, normalizeMtVat } from '../countries/mt/index.js';

describe('country packs IT and MT', () => {
  it('pass the contract checks', () => {
    expect(countryPackProblems(IT)).toEqual([]);
    expect(countryPackProblems(MT)).toEqual([]);
  });
  it('carry the current rates', () => {
    expect(IT.indirectTax.rateSets.at(-1)!.rates.map((r) => r.rate)).toEqual([22, 10, 5, 4]);
    expect(MT.indirectTax.rateSets.at(-1)!.rates.map((r) => r.rate)).toEqual([18, 12, 7, 5, 0]);
  });
});

describe('Partita IVA', () => {
  it('accepts published numbers', () => {
    expect(isValidItPartitaIva(normalizeItVat('IT 00905811006'))).toBe(true); // Eni
    expect(isValidItPartitaIva('00743110157')).toBe(true); // python-stdnum example
  });
  it('rejects a wrong check digit, office code or length', () => {
    expect(isValidItPartitaIva('00905811007')).toBe(false);
    expect(isValidItPartitaIva('0090581100')).toBe(false);
    // Office code 101 is not assigned (valid Luhn otherwise).
    expect(isValidItPartitaIva('12345671015')).toBe(false);
    expect(isValidItPartitaIva('')).toBe(false);
  });
});

describe('codice fiscale', () => {
  it('accepts the Mario Rossi example and a company code', () => {
    expect(isValidItCodiceFiscale('RSSMRA85T10A562S')).toBe(true);
    expect(isValidItCodiceFiscale('00905811006')).toBe(true);
  });
  it('checks the control letter', () => {
    expect(isValidItCodiceFiscale('RSSMRA85T10A562T')).toBe(false);
  });
  it('accepts omocodia with a recomputed control letter', () => {
    // The last digit 2 becomes N; the check letter follows the new string.
    const first15 = 'RSSMRA85T10A56N';
    const omocode = first15 + itCodiceFiscaleCheckChar(first15);
    expect(isValidItCodiceFiscale(omocode)).toBe(true);
    expect(isValidItCodiceFiscale(first15 + 'S')).toBe(omocode.endsWith('S'));
  });
  it('rejects impossible birth days and months', () => {
    const noDay = 'RSSMRA85T35A562';
    expect(isValidItCodiceFiscale(noDay + itCodiceFiscaleCheckChar(noDay))).toBe(false);
    const woman = 'RSSMRA85T50A562'; // day 10 + 40
    expect(isValidItCodiceFiscale(woman + itCodiceFiscaleCheckChar(woman))).toBe(true);
    const badMonth = 'RSSMRA85F10A562';
    expect(isValidItCodiceFiscale(badMonth + itCodiceFiscaleCheckChar(badMonth))).toBe(false);
  });
});

describe('Maltese VAT number', () => {
  it('accepts the published example', () => {
    expect(isValidMtVat(normalizeMtVat('MT 1167-9112'))).toBe(true);
  });
  it('rejects a wrong check pair or a leading zero', () => {
    expect(isValidMtVat('11679113')).toBe(false);
    expect(isValidMtVat('01679112')).toBe(false);
    expect(isValidMtVat('')).toBe(false);
  });
});

describe('Italian holidays and deadlines', () => {
  it('lists the 2026 holidays, San Francesco included', () => {
    expect(italyHolidays(2026)).toEqual([
      '2026-01-01', '2026-01-06', '2026-04-05', '2026-04-06', '2026-04-25', '2026-05-01',
      '2026-06-02', '2026-08-15', '2026-10-04', '2026-11-01', '2026-12-08', '2026-12-25', '2026-12-26',
    ]);
    expect(italyHolidays(2025)).not.toContain('2025-10-04');
  });
  it('moves deadlines past weekends, holidays and the August break', () => {
    expect(italyDeadlineDate(2026, 5, 16, true)).toBe('2026-05-18'); // Saturday
    expect(italyDeadlineDate(2026, 8, 16, true)).toBe('2026-08-20'); // August payments
    expect(italyDeadlineDate(2026, 8, 16)).toBe('2026-08-17'); // not a payment
    expect(italyDeadlineDate(2026, 5, 31)).toBe('2026-06-01'); // Sunday, 2 June is a holiday but 1 June is not
  });
  it('builds the 2026 VAT calendar', () => {
    const d = italyDeadlines(2026);
    expect(d.filter((x) => x.kind === 'vat_payment_monthly')).toHaveLength(12);
    expect(d.filter((x) => x.kind === 'vat_lipe').map((x) => x.date)).toEqual([
      '2026-03-02', '2026-06-01', '2026-09-30', '2026-11-30',
    ]);
    expect(d.find((x) => x.kind === 'vat_return')!.date).toBe('2026-04-30');
    expect(d.find((x) => x.kind === 'vat_advance')!.date).toBe('2026-12-28');
  });
  it('flags the stamp duty above EUR 77.47', () => {
    expect(italyStampDutyDue(77.47)).toBe(false);
    expect(italyStampDutyDue(77.48)).toBe(true);
  });
});

describe('Maltese holidays and deadlines', () => {
  it('lists the 14 holidays of 2026', () => {
    expect(maltaHolidays(2026)).toEqual([
      '2026-01-01', '2026-02-10', '2026-03-19', '2026-03-31', '2026-04-03', '2026-05-01', '2026-06-07',
      '2026-06-29', '2026-08-15', '2026-09-08', '2026-09-21', '2026-12-08', '2026-12-13', '2026-12-25',
    ]);
  });
  it('lists the quarterly VAT returns', () => {
    expect(maltaDeadlines(2026).map((d) => d.date)).toEqual(['2026-02-15', '2026-05-15', '2026-08-15', '2026-11-15']);
  });
});
