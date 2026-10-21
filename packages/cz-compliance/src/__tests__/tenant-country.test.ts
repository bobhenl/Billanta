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

  it('lists CZ and SK first and selectable, other packs as coming soon', () => {
    const list = onboardingCountries();
    expect(list.slice(0, 2)).toEqual([
      { code: 'CZ', active: true },
      { code: 'SK', active: true },
    ]);
    expect(list.slice(2).every((c) => !c.active && /^[A-Z]{2}$/.test(c.code))).toBe(true);
  });
});
