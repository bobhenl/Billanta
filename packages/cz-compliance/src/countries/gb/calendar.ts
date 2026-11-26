import { easterSunday } from '../../public-holidays.js';
import type { CountryTaxDeadline } from '../types.js';

export type UkNation = 'GB-ENG' | 'GB-WLS' | 'GB-SCT' | 'GB-NIR';

const iso = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** The n-th `weekday` (0 = Sunday) of a month. */
const nthWeekday = (year: number, month: number, weekday: number, n: number): Date => {
  const d = new Date(year, month - 1, 1);
  d.setDate(1 + ((weekday - d.getDay() + 7) % 7) + (n - 1) * 7);
  return d;
};

const lastWeekday = (year: number, month: number, weekday: number): Date => {
  const d = new Date(year, month, 0);
  d.setDate(d.getDate() - ((d.getDay() - weekday + 7) % 7));
  return d;
};

const easter = (year: number, offset: number): Date => {
  const d = easterSunday(year);
  d.setDate(d.getDate() + offset);
  return d;
};

/**
 * One-off changes by Royal Proclamation (https://www.gov.uk/bank-holidays),
 * the same in all four nations. `drop` removes the regular day that moved.
 */
const ONE_OFF: Record<number, { add: string[]; drop: string[] }> = {
  2020: { add: ['2020-05-08'], drop: ['2020-05-04'] }, // VE Day 75
  2022: { add: ['2022-06-02', '2022-06-03', '2022-09-19'], drop: ['2022-05-30'] }, // Platinum Jubilee, State Funeral
  2023: { add: ['2023-05-08'], drop: [] }, // Coronation
};

/**
 * Bank holidays per nation (Banking and Financial Dealings Act 1971, Sch. 1;
 * dates as published on https://www.gov.uk/bank-holidays). A fixed-date
 * holiday on a weekend moves to the next free weekday ("substitute day").
 */
export function ukBankHolidays(year: number, nation: UkNation = 'GB-ENG'): string[] {
  const fixed: [number, number][] = [[1, 1]];
  if (nation === 'GB-SCT') fixed.push([1, 2]);
  if (nation === 'GB-NIR') fixed.push([3, 17], [7, 12]);
  if (nation === 'GB-SCT') fixed.push([11, 30]);
  fixed.push([12, 25], [12, 26]);

  const taken = new Set<string>();
  for (const [m, day] of fixed) {
    const d = new Date(year, m - 1, day);
    while (d.getDay() === 0 || d.getDay() === 6 || taken.has(iso(d))) d.setDate(d.getDate() + 1);
    taken.add(iso(d));
  }

  const movable = [easter(year, -2), nthWeekday(year, 5, 1, 1), lastWeekday(year, 5, 1)];
  if (nation !== 'GB-SCT') movable.push(easter(year, 1));
  // Scotland's summer bank holiday is the first Monday of August, elsewhere the last.
  movable.push(nation === 'GB-SCT' ? nthWeekday(year, 8, 1, 1) : lastWeekday(year, 8, 1));
  for (const d of movable) taken.add(iso(d));

  const special = ONE_OFF[year];
  for (const d of special?.drop ?? []) taken.delete(d);
  for (const d of special?.add ?? []) taken.add(d);
  return [...taken].sort();
}

/**
 * VAT return and payment are due one calendar month and 7 days after the end
 * of the VAT period (https://www.gov.uk/vat-returns/deadlines). Periods end on
 * a month end, so the deadline is the 7th of the second following month.
 */
export function ukVatReturnDue(periodEnd: string): string {
  const [y, m] = periodEnd.split('-').map(Number) as [number, number];
  return iso(new Date(y, m + 1, 7));
}

export function ukDeadlines(year: number): CountryTaxDeadline[] {
  const vat = (periodEnd: string): CountryTaxDeadline => ({
    date: ukVatReturnDue(periodEnd),
    kind: 'vat_return',
    title: { en: `VAT return and payment (period to ${periodEnd})` },
    appliesTo: 'quarterly VAT filers on calendar quarters; other staggers shift by one or two months',
  });
  // Self Assessment: https://www.gov.uk/self-assessment-tax-returns/deadlines
  const out: CountryTaxDeadline[] = [
    vat(`${year - 1}-12-31`),
    {
      date: `${year}-01-31`,
      kind: 'self_assessment',
      title: { en: `Self Assessment online return and balancing payment (tax year ${year - 2}–${String(year - 1).slice(2)})` },
      appliesTo: 'sole traders, partners and others in Self Assessment',
    },
    vat(`${year}-03-31`),
    vat(`${year}-06-30`),
    {
      date: `${year}-07-31`,
      kind: 'self_assessment_poa',
      title: { en: 'Self Assessment second payment on account' },
      appliesTo: 'taxpayers with payments on account',
    },
    vat(`${year}-09-30`),
    {
      date: `${year}-10-05`,
      kind: 'self_assessment_register',
      title: { en: 'Register for Self Assessment (newly self-employed)' },
    },
    {
      date: `${year}-10-31`,
      kind: 'self_assessment_paper',
      title: { en: 'Self Assessment paper return' },
    },
  ];
  // Making Tax Digital for Income Tax: quarterly updates from 6 April 2026, due
  // the 7th of the month after each standard quarter
  // (https://www.gov.uk/guidance/check-if-youre-eligible-for-making-tax-digital-for-income-tax).
  if (year >= 2026) {
    const quarters = year === 2026 ? ['08-07', '11-07'] : ['02-07', '05-07', '08-07', '11-07'];
    for (const q of quarters) {
      out.push({
        date: `${year}-${q}`,
        kind: 'mtd_itsa_update',
        title: { en: 'Making Tax Digital for Income Tax quarterly update' },
        appliesTo:
          'sole traders and landlords with qualifying income over GBP 50,000 (from April 2026), GBP 30,000 (April 2027), GBP 20,000 (April 2028)',
      });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}
