import { easterSunday } from '../../public-holidays.js';

/**
 * Date helpers shared by the AU, NZ and SG packs. They work on calendar dates
 * in UTC so the result never depends on the server's time zone.
 */

export const ymd = (d: Date): string => d.toISOString().slice(0, 10);

export const utc = (year: number, month: number, day: number): Date => new Date(Date.UTC(year, month - 1, day));

export const addDays = (d: Date, days: number): Date => new Date(d.getTime() + days * 86_400_000);

export const isWeekend = (d: Date): boolean => d.getUTCDay() === 0 || d.getUTCDay() === 6;

/** The `n`-th `weekday` (0 = Sunday) of a month; `n = -1` is the last one. */
export function nthWeekday(year: number, month: number, weekday: number, n: number): Date {
  if (n === -1) {
    const last = utc(year, month + 1, 0);
    return addDays(last, -((last.getUTCDay() - weekday + 7) % 7));
  }
  const first = utc(year, month, 1);
  return addDays(first, ((weekday - first.getUTCDay() + 7) % 7) + (n - 1) * 7);
}

export function easter(year: number): Date {
  const e = easterSunday(year);
  return utc(e.getFullYear(), e.getMonth() + 1, e.getDate());
}

/**
 * Days that fall on a weekend get a substitute on the next weekday not already
 * taken by the group, in order. That one rule covers Christmas + Boxing Day in
 * AU and NZ (Sat → Mon/Tue, Sun → Tue when Boxing Day is the Monday) and the
 * NZ 1–2 January pair. Returns the original days plus the substitutes.
 */
export function withSubstitutes(days: readonly Date[]): Date[] {
  const taken = new Set(days.filter((d) => !isWeekend(d)).map(ymd));
  const out = [...days];
  for (const d of days) {
    if (!isWeekend(d)) continue;
    let s = addDays(d, 1);
    while (isWeekend(s) || taken.has(ymd(s))) s = addDays(s, 1);
    taken.add(ymd(s));
    out.push(s);
  }
  return out;
}

/** A weekend day moved to the following Monday ("Mondayised"), the day itself kept. */
export const mondayised = (d: Date): Date[] =>
  d.getUTCDay() === 6 ? [d, addDays(d, 2)] : d.getUTCDay() === 0 ? [d, addDays(d, 1)] : [d];

export const sortedUnique = (days: readonly Date[]): string[] => [...new Set(days.map(ymd))].sort();

/** The date itself or the next day that is neither a weekend nor in `holidays`. */
export function nextBusinessDay(date: Date, holidays: ReadonlySet<string>): Date {
  let d = date;
  while (isWeekend(d) || holidays.has(ymd(d))) d = addDays(d, 1);
  return d;
}
