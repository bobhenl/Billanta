import { easterSunday } from '../../public-holidays.js';
import type { CountryTaxDeadline } from '../types.js';

const iso = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const fromEaster = (year: number, days: number): Date => {
  const d = easterSunday(year);
  d.setDate(d.getDate() + days);
  return d;
};

/**
 * Public holidays (lög um 40 stunda vinnuviku nr. 88/1971, 6. gr.; bank
 * closing days per Seðlabanki). Christmas Eve and New Year's Eve are
 * holidays from 13:00; they are listed because banks and Skatturinn close.
 */
export function isHolidays(year: number): string[] {
  // Sumardagurinn fyrsti: the first Thursday after 18 April.
  const summer = new Date(year, 3, 19);
  while (summer.getDay() !== 4) summer.setDate(summer.getDate() + 1);
  // Frídagur verslunarmanna: the first Monday of August.
  const commerce = new Date(year, 7, 1);
  while (commerce.getDay() !== 1) commerce.setDate(commerce.getDate() + 1);
  return [
    new Date(year, 0, 1),
    fromEaster(year, -3), // skírdagur
    fromEaster(year, -2), // föstudagurinn langi
    fromEaster(year, 0),
    fromEaster(year, 1),
    summer,
    new Date(year, 4, 1),
    fromEaster(year, 39), // uppstigningardagur
    fromEaster(year, 49), // hvítasunnudagur
    fromEaster(year, 50),
    new Date(year, 5, 17),
    commerce,
    new Date(year, 11, 24),
    new Date(year, 11, 25),
    new Date(year, 11, 26),
    new Date(year, 11, 31),
  ]
    .map(iso)
    .sort();
}

function nextBusinessDay(year: number, month: number, day: number): string {
  const d = new Date(year, month - 1, day);
  const holidays = new Set(isHolidays(d.getFullYear()));
  while (d.getDay() === 0 || d.getDay() === 6 || holidays.has(iso(d))) d.setDate(d.getDate() + 1);
  return iso(d);
}

/**
 * VAT (virðisaukaskattur) for the standard two-month periods is due on the
 * 5th of the second month after the period ends, moved to the next business
 * day (lög nr. 50/1988 um virðisaukaskatt, 24. gr.; Skatturinn).
 */
export function isDeadlines(year: number): CountryTaxDeadline[] {
  const periods: [number, string][] = [
    [2, `Nov–Dec ${year - 1}`],
    [4, 'Jan–Feb'],
    [6, 'Mar–Apr'],
    [8, 'May–Jun'],
    [10, 'Jul–Aug'],
    [12, 'Sep–Oct'],
  ];
  return periods.map(([month, period]) => ({
    date: nextBusinessDay(year, month, 5),
    kind: 'vat_return',
    title: { en: `VAT return and payment (${period})`, is: `Virðisaukaskattsskýrsla og greiðsla (${period})` },
    appliesTo: 'businesses on the standard two-month VAT period',
  }));
}
