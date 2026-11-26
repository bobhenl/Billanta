import type { CountryTaxDeadline } from '../types.js';

const iso = (d: Date) => d.toISOString().slice(0, 10);
const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));

/** The n-th weekday (0 = Sunday) of a month; n = -1 is the last one. */
function nthWeekday(year: number, month: number, weekday: number, n: number): Date {
  if (n === -1) {
    const last = utc(year, month + 1, 0);
    return utc(year, month, last.getUTCDate() - ((last.getUTCDay() - weekday + 7) % 7));
  }
  const first = utc(year, month, 1);
  return utc(year, month, 1 + ((weekday - first.getUTCDay() + 7) % 7) + (n - 1) * 7);
}

/** A fixed-date holiday on Saturday is observed on Friday, on Sunday on Monday (5 U.S.C. 6103(b), OPM). */
function observed(d: Date): Date {
  const day = d.getUTCDay();
  if (day === 6) return utc(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate() - 1);
  if (day === 0) return utc(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate() + 1);
  return d;
}

/**
 * The eleven federal holidays of 5 U.S.C. 6103(a), as observed dates, so they
 * can be used directly as non-working days. When 1 January falls on a
 * Saturday it is observed on 31 December of the year before, so that year
 * lists no New Year's Day and the year before lists 31 December.
 * https://www.opm.gov/policy-data-oversight/pay-leave/federal-holidays/
 */
export function usFederalHolidays(year: number): string[] {
  const dates = [
    observed(utc(year, 1, 1)),
    nthWeekday(year, 1, 1, 3), // Birthday of Martin Luther King, Jr.
    nthWeekday(year, 2, 1, 3), // Washington's Birthday
    nthWeekday(year, 5, 1, -1), // Memorial Day
    ...(year >= 2021 ? [observed(utc(year, 6, 19))] : []), // Juneteenth National Independence Day
    observed(utc(year, 7, 4)),
    nthWeekday(year, 9, 1, 1), // Labor Day
    nthWeekday(year, 10, 1, 2), // Columbus Day
    observed(utc(year, 11, 11)), // Veterans Day
    nthWeekday(year, 11, 4, 4), // Thanksgiving Day
    observed(utc(year, 12, 25)),
    observed(utc(year + 1, 1, 1)), // next New Year's Day, when observed on 31 December
  ];
  return dates.filter((d) => d.getUTCFullYear() === year).map(iso).sort();
}

/**
 * IRC §7503: a deadline on a weekend or a legal holiday moves to the next
 * business day. Legal holidays include DC Emancipation Day (16 April), which
 * is why the April deadline sometimes lands on the 17th or 18th.
 */
export function nextIrsBusinessDay(date: string): string {
  const year = Number(date.slice(0, 4));
  const closed = new Set([...usFederalHolidays(year), ...usFederalHolidays(year + 1), iso(observed(utc(year, 4, 16)))]);
  let d = utc(year, Number(date.slice(5, 7)), Number(date.slice(8, 10)));
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6 || closed.has(iso(d))) {
    d = utc(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate() + 1);
  }
  return iso(d);
}

/**
 * Federal deadlines a freelancer or small business meets during `year`.
 * State income and sales-tax returns differ per state and filing frequency
 * and are not listed.
 */
export function usDeadlines(year: number): CountryTaxDeadline[] {
  const at = (month: number, day: number) => nextIrsBusinessDay(`${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`);
  const est = 'individuals and sole proprietors who expect to owe USD 1,000 or more';
  return [
    // https://www.irs.gov/businesses/small-businesses-self-employed/estimated-taxes
    { date: at(1, 15), kind: 'estimated_tax', title: { en: `Estimated tax, 4th instalment of ${year - 1} (Form 1040-ES)` }, appliesTo: est },
    // https://www.irs.gov/instructions/i1099mec; the USD 2,000 threshold for payments from 2026 comes from P.L. 119-21 §70433
    { date: at(1, 31), kind: 'form_1099_nec', title: { en: 'Form 1099-NEC to contractors and the IRS' }, appliesTo: `businesses that paid a contractor USD ${year - 1 >= 2026 ? '2,000' : '600'} or more in ${year - 1}` },
    { date: at(1, 31), kind: 'form_w2', title: { en: 'Forms W-2 to employees and the SSA' }, appliesTo: 'employers' },
    { date: at(3, 15), kind: 'partnership_s_corp_return', title: { en: 'Partnership and S-corporation returns (Form 1065, 1120-S)' }, appliesTo: 'calendar-year partnerships, multi-member LLCs and S corporations' },
    { date: at(4, 15), kind: 'income_tax_return', title: { en: `Individual and C-corporation returns for ${year - 1} (Form 1040, 1120)` }, appliesTo: 'calendar-year filers; Schedule C covers sole proprietors and single-member LLCs' },
    { date: at(4, 15), kind: 'estimated_tax', title: { en: `Estimated tax, 1st instalment of ${year}` }, appliesTo: est },
    { date: at(6, 15), kind: 'estimated_tax', title: { en: `Estimated tax, 2nd instalment of ${year}` }, appliesTo: est },
    { date: at(9, 15), kind: 'estimated_tax', title: { en: `Estimated tax, 3rd instalment of ${year}` }, appliesTo: est },
  ].sort((a, b) => a.date.localeCompare(b.date));
}
