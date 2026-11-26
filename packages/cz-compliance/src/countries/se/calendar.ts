/**
 * Date helpers shared by the Nordic and Baltic packs (SE, DK, FI, EE, LV, LT).
 * They live here only because packs are built in separate folders; move them
 * to a shared countries/ helper when the packs are registered.
 */
import { easterSunday } from '../../public-holidays.js';

export const isoDate = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export const ymd = (year: number, month: number, day: number): Date => new Date(year, month - 1, day);

export const easterOffset = (year: number, days: number): Date => {
  const e = easterSunday(year);
  return new Date(e.getFullYear(), e.getMonth(), e.getDate() + days);
};

/** The first `weekday` (0 = Sunday … 6 = Saturday) on or after the given date. */
export const weekdayOnOrAfter = (year: number, month: number, day: number, weekday: number): Date => {
  const d = ymd(year, month, day);
  d.setDate(d.getDate() + ((weekday - d.getDay() + 7) % 7));
  return d;
};

/** Sorted, de-duplicated ISO dates. */
export const isoList = (dates: Date[]): string[] => [...new Set(dates.map(isoDate))].sort();

/** Moves a deadline that falls on a weekend or holiday to the next working day. */
export const nextWorkingDay = (d: Date, holidays: readonly string[]): string => {
  const x = new Date(d);
  while (x.getDay() === 0 || x.getDay() === 6 || holidays.includes(isoDate(x))) x.setDate(x.getDate() + 1);
  return isoDate(x);
};
