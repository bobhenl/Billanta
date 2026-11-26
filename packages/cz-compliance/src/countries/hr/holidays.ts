import { easterSunday } from '../../public-holidays.js';

/**
 * Croatian public holidays from Zakon o blagdanima, spomendanima i neradnim
 * danima u Republici Hrvatskoj (NN 110/19), in force from 2020: 30 May and
 * 18 November added, 25 June and 8 October dropped.
 * https://narodne-novine.nn.hr/clanci/sluzbeni/2019_11_110_2212.html
 */
export function hrHolidays(year: number): string[] {
  const fixed =
    year >= 2020
      ? ['01-01', '01-06', '05-01', '05-30', '06-22', '08-05', '08-15', '11-01', '11-18', '12-25', '12-26']
      : ['01-01', '01-06', '05-01', '06-22', '06-25', '08-05', '08-15', '10-08', '11-01', '12-25', '12-26'];
  const easter = easterSunday(year);
  // Easter Sunday, Easter Monday and Corpus Christi (Tijelovo, Easter + 60).
  const fromEaster = [0, 1, 60].map((offset) => iso(new Date(year, easter.getMonth(), easter.getDate() + offset)));
  return [...fixed.map((md) => `${year}-${md}`), ...fromEaster].sort();
}

/**
 * `day` of `month` (1-12), moved to the next working day when it falls on a
 * weekend or holiday (Opći porezni zakon, NN 115/16, art. 87).
 */
export function hrDeadlineOn(year: number, month: number, day: number): string {
  const holidays = new Set([...hrHolidays(year), ...hrHolidays(year + 1)]);
  const d = new Date(year, month - 1, day);
  while (d.getDay() === 0 || d.getDay() === 6 || holidays.has(iso(d))) d.setDate(d.getDate() + 1);
  return iso(d);
}

function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
