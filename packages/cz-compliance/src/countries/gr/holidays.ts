import { fromOrthodoxEaster, isoDate } from './orthodox-easter.js';

/**
 * Greek nationwide public holidays (αργίες): the fixed ones plus Clean Monday
 * (Easter − 48), Good Friday, Easter Sunday and Monday and Whit Monday
 * (Easter + 50), all from Orthodox Easter. Local saints' days are left out.
 * Source: Ministry of Labour, "Αργίες" (https://www.ypergasias.gov.gr/).
 */
export function grHolidays(year: number): string[] {
  const fixed = ['01-01', '01-06', '03-25', '05-01', '08-15', '10-28', '12-25', '12-26'].map((md) => `${year}-${md}`);
  return [...new Set([...fixed, ...fromOrthodoxEaster(year, [-48, -2, 0, 1, 50])])].sort();
}

/** Last day of `month` (1-12) that is neither a weekend nor a Greek holiday. */
export function grLastWorkingDay(year: number, month: number): string {
  const holidays = new Set(grHolidays(year));
  const d = new Date(year, month, 0);
  while (d.getDay() === 0 || d.getDay() === 6 || holidays.has(isoDate(d))) d.setDate(d.getDate() - 1);
  return isoDate(d);
}
