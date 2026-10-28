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
 * Public holidays (lov om helligdager og helligdagsfred § 2, and lov om 1. og
 * 17. mai som høgtidsdager). Sundays are holidays too but are not listed.
 */
export function noHolidays(year: number): string[] {
  return [
    new Date(year, 0, 1),
    fromEaster(year, -3), // skjærtorsdag
    fromEaster(year, -2), // langfredag
    fromEaster(year, 0),
    fromEaster(year, 1),
    new Date(year, 4, 1),
    new Date(year, 4, 17),
    fromEaster(year, 39), // Kristi himmelfartsdag
    fromEaster(year, 49), // pinsedag
    fromEaster(year, 50),
    new Date(year, 11, 25),
    new Date(year, 11, 26),
  ]
    .map(iso)
    .sort();
}

/** Skatteetaten moves a deadline that falls on a weekend or public holiday to the next working day. */
function nextWorkingDay(year: number, month: number, day: number): string {
  const d = new Date(year, month - 1, day);
  const holidays = new Set(noHolidays(d.getFullYear()));
  while (d.getDay() === 0 || d.getDay() === 6 || holidays.has(iso(d))) d.setDate(d.getDate() + 1);
  return iso(d);
}

/**
 * MVA-melding for the standard two-month terms (Skatteetaten "Frister for
 * mva-meldingen"): 10 April, 10 June, 31 August, 10 October, 10 December and
 * 10 February; the skattemelding for sole traders is due 31 May.
 */
export function noDeadlines(year: number): CountryTaxDeadline[] {
  const terms: [number, number, string][] = [
    [2, 10, `6th term (Nov–Dec ${year - 1})`],
    [4, 10, '1st term (Jan–Feb)'],
    [6, 10, '2nd term (Mar–Apr)'],
    [8, 31, '3rd term (May–Jun)'],
    [10, 10, '4th term (Jul–Aug)'],
    [12, 10, '5th term (Sep–Oct)'],
  ];
  const out: CountryTaxDeadline[] = terms.map(([m, d, term]) => ({
    date: nextWorkingDay(year, m, d),
    kind: 'vat_return',
    title: { en: `VAT return and payment, ${term}`, nb: `MVA-melding og betaling, ${term}` },
    appliesTo: 'businesses on the standard two-month VAT term',
  }));
  out.push({
    date: nextWorkingDay(year, 5, 31),
    kind: 'income_tax',
    title: { en: `Tax return for business owners (${year - 1})`, nb: `Skattemelding for næringsdrivende (${year - 1})` },
    appliesTo: 'sole traders (enkeltpersonforetak) and companies',
  });
  return out.sort((a, b) => a.date.localeCompare(b.date));
}
