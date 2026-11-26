/**
 * Date helpers shared by the HU, RO and BG packs. They work on UTC dates and
 * ISO strings so the result never depends on the server's time zone. Kept
 * here (not in a shared module) because packs are built in parallel; move
 * them to a common place when the packs are registered.
 */

export const isoDate = (d: Date): string => d.toISOString().slice(0, 10);

export const utc = (year: number, month: number, day: number): Date => new Date(Date.UTC(year, month - 1, day));

export const addDays = (d: Date, days: number): Date => new Date(d.getTime() + days * 86_400_000);

/**
 * Orthodox Easter Sunday as a Gregorian date (Meeus' Julian algorithm plus
 * the Julian–Gregorian offset). Romania and Bulgaria use it for Good Friday,
 * Easter and, in Romania, Pentecost. The offset is 13 days for 1900–2099.
 */
export function orthodoxEaster(year: number): Date {
  const a = year % 4;
  const b = year % 7;
  const c = year % 19;
  const d = (19 * c + 15) % 30;
  const e = (2 * a + 4 * b - d + 34) % 7;
  const month = Math.floor((d + e + 114) / 31);
  const day = ((d + e + 114) % 31) + 1;
  const offset = Math.floor(year / 100) - Math.floor(year / 400) - 2;
  return addDays(utc(year, month, day), offset);
}

export const isWeekend = (d: Date): boolean => d.getUTCDay() === 0 || d.getUTCDay() === 6;

/** The date itself when it is a working day, else the next one (deadlines that fall on a rest day move forward). */
export function onOrNextWorkingDay(d: Date, holidays: ReadonlySet<string>): Date {
  let cur = d;
  while (isWeekend(cur) || holidays.has(isoDate(cur))) cur = addDays(cur, 1);
  return cur;
}

/** One date per month of `year` on `day` (clamped to the month end), moved to a working day: monthly returns for the previous month. */
export function monthlyDueDates(year: number, day: number, holidays: (y: number) => string[]): Date[] {
  const rest = new Set([...holidays(year), ...holidays(year + 1)]);
  const out: Date[] = [];
  for (let m = 1; m <= 12; m++) {
    const last = new Date(Date.UTC(year, m, 0)).getUTCDate();
    out.push(onOrNextWorkingDay(utc(year, m, Math.min(day, last)), rest));
  }
  return out;
}
