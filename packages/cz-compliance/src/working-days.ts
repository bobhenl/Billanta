/**
 * Czech public holidays and working days (zákon č. 245/2000 Sb.).
 * Ported from faktorio (MIT, © Jiri Spac) — `czechWorkingDays.ts`.
 * Thin Czech wrappers over the per-country rules in `public-holidays.ts`.
 *
 * All functions work on local calendar dates; the time of day is ignored.
 */
import { isWorkingDay, nextWorkingDay, publicHolidayOn, publicHolidays } from './public-holidays.js';

export { easterSunday } from './public-holidays.js';

/** All Czech public holidays of `year`, sorted. Good Friday counts from 2016. */
export function czechHolidays(year: number): Date[] {
  return publicHolidays(year, 'CZ').map((h) => h.date);
}

export function isCzechHoliday(date: Date): boolean {
  return publicHolidayOn(date, 'CZ') !== null;
}

export function isCzechWorkingDay(date: Date): boolean {
  return isWorkingDay(date, 'CZ');
}

/** `date` itself when it is a working day, otherwise the next one. */
export function nextCzechWorkingDay(date: Date): Date {
  return nextWorkingDay(date, 'CZ');
}

/** Number of working days in a month (`month` 1–12). */
export function czechWorkingDaysInMonth(year: number, month: number): number {
  let count = 0;
  for (const d = new Date(year, month - 1, 1); d.getMonth() === month - 1; d.setDate(d.getDate() + 1)) {
    if (isCzechWorkingDay(d)) count++;
  }
  return count;
}
