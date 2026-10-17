import { describe, expect, it } from 'vitest';
import { holidayCountry, isWorkingDay, nextWorkingDay, publicHolidayOn, publicHolidays } from '../public-holidays.js';

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

describe('public holidays per country', () => {
  it('lists the Slovak holidays of 2026, Easter-based ones included and the abolished ones left out', () => {
    expect(publicHolidays(2026, 'SK').map((h) => `${ymd(h.date)} ${h.key}`)).toEqual([
      '2026-01-01 slovakRepublic',
      '2026-01-06 epiphany',
      '2026-04-03 goodFriday',
      '2026-04-06 easterMonday',
      '2026-05-01 labourDay',
      '2026-05-08 victoryDay',
      '2026-07-05 cyrilMethodius',
      '2026-08-29 snp',
      '2026-09-15 ourLadyOfSorrows',
      '2026-11-01 allSaints',
      '2026-12-24 christmasEve',
      '2026-12-25 christmasDay',
      '2026-12-26 stStephen',
    ]);
  });

  it('keeps 1 September and 17 November in Slovakia up to 2024', () => {
    const keys = publicHolidays(2024, 'SK').map((h) => h.key);
    expect(keys).toContain('constitution');
    expect(keys).toContain('freedomDemocracy');
  });

  it('follows the Easter date year by year', () => {
    expect(ymd(publicHolidays(2027, 'SK').find((h) => h.key === 'goodFriday')!.date)).toBe('2027-03-26');
    expect(ymd(publicHolidays(2027, 'CZ').find((h) => h.key === 'easterMonday')!.date)).toBe('2027-03-29');
  });

  it('tells holidays of one country from the other', () => {
    const jan6 = new Date(2026, 0, 6); // Tuesday
    expect(publicHolidayOn(jan6, 'SK')).toMatchObject({ key: 'epiphany', name: 'Zjavenie Pána (Traja králi)' });
    expect(publicHolidayOn(jan6, 'CZ')).toBeNull();
    const jul6 = new Date(2026, 6, 6); // Monday, Jan Hus
    expect(publicHolidayOn(jul6, 'CZ')?.key).toBe('janHus');
    expect(isWorkingDay(jul6, 'SK')).toBe(true);
    expect(isWorkingDay(jul6, 'CZ')).toBe(false);
  });

  it('accepts lower-case codes and falls back to weekends only for unknown countries', () => {
    expect(holidayCountry('sk')).toBe('SK');
    expect(holidayCountry('DE')).toBeNull();
    expect(publicHolidays(2026, 'DE')).toEqual([]);
    expect(isWorkingDay(new Date(2026, 11, 25), 'DE')).toBe(true); // Friday
    expect(isWorkingDay(new Date(2026, 11, 26), 'DE')).toBe(false); // Saturday
  });

  it('moves to the next working day across holidays and the weekend', () => {
    expect(ymd(nextWorkingDay(new Date(2026, 11, 24), 'SK'))).toBe('2026-12-28');
    expect(ymd(nextWorkingDay(new Date(2026, 0, 6), 'SK'))).toBe('2026-01-07');
    expect(ymd(nextWorkingDay(new Date(2026, 0, 6), 'CZ'))).toBe('2026-01-06');
    expect(ymd(nextWorkingDay(new Date(2026, 3, 3), 'CZ'))).toBe('2026-04-07'); // Good Friday → Easter Monday → Tuesday
  });
});
