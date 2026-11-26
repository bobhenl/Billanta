import { describe, expect, it } from 'vitest';
import { countryFromAddress, homeCurrencyForCountry, homeCurrencyOf, isActiveCountry, onboardingCountries } from '../index.js';

describe('tenant country', () => {
  it('backfills SK addresses as SK and everything else as CZ', () => {
    expect(countryFromAddress('SK')).toBe('SK');
    expect(countryFromAddress('sk')).toBe('SK');
    expect(countryFromAddress('CZ')).toBe('CZ');
    expect(countryFromAddress('DE')).toBe('CZ');
    expect(countryFromAddress(null)).toBe('CZ');
  });

  it('gives CZ and SK the same home currency as homeCurrencyOf', () => {
    for (const c of ['CZ', 'SK', 'cz', 'sk', null, undefined]) expect(homeCurrencyForCountry(c)).toBe(homeCurrencyOf(c));
  });

  it('lets only CZ and SK be picked', () => {
    expect(isActiveCountry('CZ')).toBe(true);
    expect(isActiveCountry('SK')).toBe(true);
    expect(isActiveCountry('PL')).toBe(false);
    expect(isActiveCountry(null)).toBe(false);
  });

  it('lists only CZ and SK unless the deployment names more', () => {
    expect(onboardingCountries()).toEqual([
      { code: 'CZ', active: true },
      { code: 'SK', active: true },
    ]);
  });

  it('adds the named packs as coming soon, unknown codes ignored', () => {
    expect(onboardingCountries(['pl', 'de', 'XX']).slice(2)).toEqual([
      { code: 'DE', active: false },
      { code: 'PL', active: false },
    ]);
  });

  it('lists every registered pack with all', () => {
    const list = onboardingCountries('all');
    expect(list.length).toBeGreaterThan(40);
    expect(list.slice(2).every((c) => !c.active && /^[A-Z]{2}$/.test(c.code))).toBe(true);
  });
});
