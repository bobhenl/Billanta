import { describe, expect, it } from 'vitest';
import {
  CZ_TAX_OFFICES,
  CZ_TAX_WORKPLACES,
  czTaxWorkplacesOf,
  isValidCzTaxOfficePair,
} from '../cz-tax-offices.js';
import { CZ_HEALTH_INSURERS, CZ_SOCIAL_OFFICES, czHealthInsurer, czSocialOffice } from '../cz-social-offices.js';

describe('tax office code lists', () => {
  it('has the 15 offices and every workplace belongs to one of them', () => {
    expect(CZ_TAX_OFFICES).toHaveLength(15);
    const offices = new Set(CZ_TAX_OFFICES.map((o) => o.code));
    for (const w of CZ_TAX_WORKPLACES) expect(offices.has(w.office)).toBe(true);
    // c_ufo is at most 3 digits, c_pracufo 4 (dphdp3_epo2.xsd).
    for (const o of CZ_TAX_OFFICES) expect(o.code).toBeLessThan(1000);
    for (const w of CZ_TAX_WORKPLACES) expect(w.code).toBeLessThan(10000);
  });

  it('accepts only a workplace of the chosen office', () => {
    expect(isValidCzTaxOfficePair(461, 3004)).toBe(true);
    expect(isValidCzTaxOfficePair(461, null)).toBe(true);
    expect(isValidCzTaxOfficePair(null, null)).toBe(true);
    expect(isValidCzTaxOfficePair(462, 3004)).toBe(false);
    expect(isValidCzTaxOfficePair(null, 3004)).toBe(false);
    expect(isValidCzTaxOfficePair(999, null)).toBe(false);
    expect(czTaxWorkplacesOf(461).every((w) => w.office === 461)).toBe(true);
  });
});

describe('ČSSZ code lists', () => {
  it('has the OSSZ / PSSZ offices without the ústředí', () => {
    expect(czSocialOffice(101)).toBeNull();
    expect(czSocialOffice(772)?.name).toBe('MSSZ Brno');
    expect(czSocialOffice(110)?.name).toBe('PSSZ Praha 10');
    expect(new Set(CZ_SOCIAL_OFFICES.map((o) => o.code)).size).toBe(CZ_SOCIAL_OFFICES.length);
  });

  it('has the seven health insurers still in existence', () => {
    expect(CZ_HEALTH_INSURERS.map((i) => i.code)).toEqual(['111', '201', '205', '207', '209', '211', '213']);
    expect(czHealthInsurer('217')).toBeNull();
  });
});
