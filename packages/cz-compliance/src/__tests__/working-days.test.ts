import { describe, expect, it } from 'vitest';
import {
  czechHolidays,
  czechWorkingDaysInMonth,
  easterSunday,
  isCzechWorkingDay,
  nextCzechWorkingDay,
} from '../working-days.js';

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

describe('czech working days', () => {
  it('computes Easter Sunday', () => {
    expect(ymd(easterSunday(2024))).toBe('2024-03-31');
    expect(ymd(easterSunday(2025))).toBe('2025-04-20');
    expect(ymd(easterSunday(2026))).toBe('2026-04-05');
  });

  it('lists 13 holidays incl. Good Friday and Easter Monday', () => {
    const days = czechHolidays(2026).map(ymd);
    expect(days).toHaveLength(13);
    expect(days).toContain('2026-04-03');
    expect(days).toContain('2026-04-06');
    expect(czechHolidays(2015)).toHaveLength(12);
  });

  it('skips weekends and holidays', () => {
    expect(isCzechWorkingDay(new Date(2026, 9, 28))).toBe(false); // 28. 10.
    expect(isCzechWorkingDay(new Date(2026, 9, 29))).toBe(true);
    expect(ymd(nextCzechWorkingDay(new Date(2026, 11, 24)))).toBe('2026-12-28'); // Christmas + weekend
    expect(ymd(nextCzechWorkingDay(new Date(2026, 9, 5)))).toBe('2026-10-05');
  });

  it('counts working days in a month', () => {
    expect(czechWorkingDaysInMonth(2026, 4)).toBe(20); // 22 weekdays − Good Friday − Easter Monday
    expect(czechWorkingDaysInMonth(2026, 12)).toBe(21); // 23 weekdays − 24., 25. (26. is Saturday)
  });
});
