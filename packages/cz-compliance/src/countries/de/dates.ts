import { easterSunday } from '../../public-holidays.js';

/**
 * Small date helpers the DACH packs share (AT, CH and LI import them from
 * here). All dates are local calendar dates, like `public-holidays.ts`.
 */

export function isoDate(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/** ISO date of `year-month-day`; month is 1-based and may overflow (13 = January next year). */
export function ymd(year: number, month: number, day: number): string {
  return isoDate(new Date(year, month - 1, day));
}

/** Easter Sunday of `year` shifted by `offset` days, as an ISO date. */
export function easterOffset(year: number, offset: number): string {
  const e = easterSunday(year);
  return isoDate(new Date(e.getFullYear(), e.getMonth(), e.getDate() + offset));
}

export function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return isoDate(new Date(y, m - 1, d + days));
}

/** Last day of `month` (1-based, may overflow into the next year). */
export function endOfMonth(year: number, month: number): string {
  return isoDate(new Date(year, month, 0));
}

/**
 * Moves a deadline that falls on a weekend or holiday to the next working
 * day. `holidays` decides which days count; DE § 108 Abs. 3 AO, AT § 108
 * Abs. 3 BAO and CH Art. 20 Abs. 3 VwVG all follow this rule.
 */
export function nextWorkingDay(iso: string, holidays: (year: number) => readonly string[]): string {
  let date = iso;
  for (;;) {
    const [y, m, d] = date.split('-').map(Number) as [number, number, number];
    const weekday = new Date(y, m - 1, d).getDay();
    if (weekday !== 0 && weekday !== 6 && !holidays(y).includes(date)) return date;
    date = addDays(date, 1);
  }
}
