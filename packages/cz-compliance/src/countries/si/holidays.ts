import { easterSunday } from '../../public-holidays.js';

/**
 * Slovenian public holidays and work-free days ("dela prosti dnevi"), from
 * Zakon o praznikih in dela prostih dnevih v Republiki Sloveniji (ZPDPD),
 * art. 1 and 2, with 2 January restored from 2017 (ZPDPD-I).
 * https://pisrs.si/pregledPredpisa?id=ZAKO277
 * Easter and Pentecost fall on a Sunday but are listed, as the law lists them.
 */
export function siHolidays(year: number): string[] {
  const fixed = ['01-01', '02-08', '04-27', '05-01', '05-02', '06-25', '08-15', '10-31', '11-01', '12-25', '12-26'];
  if (year >= 2017) fixed.push('01-02');
  const easter = easterSunday(year);
  const fromEaster = [0, 1, 49].map((offset) => iso(new Date(year, easter.getMonth(), easter.getDate() + offset)));
  return [...fixed.map((md) => `${year}-${md}`), ...fromEaster].sort();
}

/** Last day of `month` (1-12) that is neither a weekend nor a Slovenian holiday. */
export function siLastWorkingDay(year: number, month: number): string {
  const holidays = new Set(siHolidays(year));
  const d = new Date(year, month, 0);
  while (d.getDay() === 0 || d.getDay() === 6 || holidays.has(iso(d))) d.setDate(d.getDate() - 1);
  return iso(d);
}

function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
