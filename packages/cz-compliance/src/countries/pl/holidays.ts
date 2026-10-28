import { easterSunday } from '../../public-holidays.js';

/**
 * Days off under art. 1 ustawy z 18 stycznia 1951 r. o dniach wolnych od
 * pracy. Epiphany is a day off again since 2011 and Christmas Eve since 2025
 * (amendment passed by the Sejm on 27 November 2024). Easter Sunday and
 * Pentecost are listed by the act although they are always Sundays.
 * https://isap.sejm.gov.pl/isap.nsf/DocDetails.xsp?id=WDU19510040028
 */
const FIXED: readonly { month: number; day: number; from?: number }[] = [
  { month: 1, day: 1 },
  { month: 1, day: 6, from: 2011 },
  { month: 5, day: 1 },
  { month: 5, day: 3 },
  { month: 8, day: 15 },
  { month: 11, day: 1 },
  { month: 11, day: 11 },
  { month: 12, day: 24, from: 2025 },
  { month: 12, day: 25 },
  { month: 12, day: 26 },
];

/** Easter Sunday, Easter Monday, Pentecost (Zielone Świątki), Corpus Christi (Boże Ciało). */
const EASTER_OFFSETS = [0, 1, 49, 60];

export const isoDate = (d: Date) => d.toISOString().slice(0, 10);
const utc = (year: number, month: number, day: number) => new Date(Date.UTC(year, month - 1, day));

export function plHolidays(year: number): string[] {
  const easter = easterSunday(year);
  const dates = [
    ...FIXED.filter((h) => h.from === undefined || year >= h.from).map((h) => utc(year, h.month, h.day)),
    ...EASTER_OFFSETS.map((o) => utc(year, easter.getMonth() + 1, easter.getDate() + o)),
  ];
  return dates.map(isoDate).sort();
}

/** Saturdays, Sundays and holidays are not working days. */
export function isPlWorkingDay(date: Date): boolean {
  const dow = date.getUTCDay();
  return dow !== 0 && dow !== 6 && !plHolidays(date.getUTCFullYear()).includes(isoDate(date));
}

/**
 * Ordynacja podatkowa art. 12 § 5: a deadline that falls on a Saturday or a
 * day off by law moves to the next day that is neither. Works on UTC dates.
 */
export function plDeadline(year: number, month: number, day: number): string {
  const d = utc(year, month, day);
  while (!isPlWorkingDay(d)) d.setUTCDate(d.getUTCDate() + 1);
  return isoDate(d);
}

/** The last working day before `isoTaxPoint`, the NBP rate date of art. 31a ust. 1 ustawy o VAT. */
export function plRateDate(isoTaxPoint: string): string {
  const d = new Date(`${isoTaxPoint}T00:00:00Z`);
  do d.setUTCDate(d.getUTCDate() - 1);
  while (!isPlWorkingDay(d));
  return isoDate(d);
}
