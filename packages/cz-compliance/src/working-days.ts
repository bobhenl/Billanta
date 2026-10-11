/**
 * Czech public holidays and working days (zákon č. 245/2000 Sb.).
 * Ported from faktorio (MIT, © Jiri Spac) — `czechWorkingDays.ts`.
 *
 * All functions work on local calendar dates; the time of day is ignored.
 */

/** Easter Sunday of `year` (Gregorian, anonymous algorithm). */
export function easterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

const FIXED_HOLIDAYS: [month: number, day: number][] = [
  [1, 1], // Den obnovy samostatného českého státu, Nový rok
  [5, 1], // Svátek práce
  [5, 8], // Den vítězství
  [7, 5], // Cyril a Metoděj
  [7, 6], // Jan Hus
  [9, 28], // Den české státnosti
  [10, 28], // Vznik samostatného československého státu
  [11, 17], // Den boje za svobodu a demokracii
  [12, 24], // Štědrý den
  [12, 25], // 1. svátek vánoční
  [12, 26], // 2. svátek vánoční
];

const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
const cache = new Map<number, Set<string>>();

/** All Czech public holidays of `year`, sorted. Good Friday counts from 2016. */
export function czechHolidays(year: number): Date[] {
  const easter = easterSunday(year);
  const shifted = (days: number) => new Date(year, easter.getMonth(), easter.getDate() + days);
  const days = FIXED_HOLIDAYS.map(([m, d]) => new Date(year, m - 1, d));
  days.push(shifted(1)); // Velikonoční pondělí
  if (year >= 2016) days.push(shifted(-2)); // Velký pátek
  return days.sort((x, y) => x.getTime() - y.getTime());
}

export function isCzechHoliday(date: Date): boolean {
  const year = date.getFullYear();
  let set = cache.get(year);
  if (!set) {
    set = new Set(czechHolidays(year).map(dayKey));
    cache.set(year, set);
  }
  return set.has(dayKey(date));
}

export function isCzechWorkingDay(date: Date): boolean {
  const dow = date.getDay();
  return dow !== 0 && dow !== 6 && !isCzechHoliday(date);
}

/** `date` itself when it is a working day, otherwise the next one. */
export function nextCzechWorkingDay(date: Date): Date {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  while (!isCzechWorkingDay(d)) d.setDate(d.getDate() + 1);
  return d;
}

/** Number of working days in a month (`month` 1–12). */
export function czechWorkingDaysInMonth(year: number, month: number): number {
  let count = 0;
  for (const d = new Date(year, month - 1, 1); d.getMonth() === month - 1; d.setDate(d.getDate() + 1)) {
    if (isCzechWorkingDay(d)) count++;
  }
  return count;
}
