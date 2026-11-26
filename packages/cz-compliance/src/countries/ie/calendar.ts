import { easterSunday } from '../../public-holidays.js';
import type { CountryTaxDeadline } from '../types.js';

const iso = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const firstMonday = (year: number, month: number): Date => {
  const d = new Date(year, month - 1, 1);
  d.setDate(1 + ((8 - d.getDay()) % 7));
  return d;
};

const lastMonday = (year: number, month: number): Date => {
  const d = new Date(year, month, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
};

/**
 * Public holidays (Organisation of Working Time Act 1997, Sch. 2, as amended;
 * list on citizensinformation.ie). Ireland has no automatic substitute day: a
 * holiday on a weekend stays on that date and employees get another benefit.
 * Good Friday is not a public holiday.
 */
export function ieHolidays(year: number): string[] {
  const easterMonday = easterSunday(year);
  easterMonday.setDate(easterMonday.getDate() + 1);
  const dates = [
    new Date(year, 0, 1),
    easterMonday,
    firstMonday(year, 5),
    firstMonday(year, 6),
    firstMonday(year, 8),
    lastMonday(year, 10),
    new Date(year, 2, 17),
    new Date(year, 11, 25),
    new Date(year, 11, 26),
  ];
  // St Brigid's Day since 2023 (S.I. 50/2022): first Monday of February, or
  // 1 February when that is a Friday.
  if (year >= 2023) {
    const feb1 = new Date(year, 1, 1);
    dates.push(feb1.getDay() === 5 ? feb1 : firstMonday(year, 2));
  }
  const out = dates.map(iso);
  if (year === 2022) out.push('2022-03-18'); // one-off Covid recognition day
  return out.sort();
}

/**
 * VAT3 returns are bi-monthly, due the 19th of the month after the period,
 * extended to the 23rd for returns filed and paid on ROS
 * (https://www.revenue.ie/en/vat/returns-and-payment/index.aspx).
 */
export function ieDeadlines(year: number): CountryTaxDeadline[] {
  const out: CountryTaxDeadline[] = [];
  const periods = ['Nov–Dec', 'Jan–Feb', 'Mar–Apr', 'May–Jun', 'Jul–Aug', 'Sep–Oct'];
  for (let i = 0; i < 6; i++) {
    out.push({
      date: `${year}-${String(i * 2 + 1).padStart(2, '0')}-23`,
      kind: 'vat_return',
      title: { en: `VAT3 return and payment (${periods[i]}${i === 0 ? ` ${year - 1}` : ''}, ROS)` },
      appliesTo: 'bi-monthly VAT filers using ROS (19th for paper filers)',
    });
  }
  out.push(
    {
      // The annual Return of Trading Details is due with the last VAT3 of the year.
      date: `${year}-01-23`,
      kind: 'vat_rtd',
      title: { en: `VAT Return of Trading Details (${year - 1}, ROS)` },
    },
    {
      // Pay and file: Form 11 for the previous year plus preliminary tax for the
      // current one (Taxes Consolidation Act 1997 s. 959I); ROS usually extends it to mid-November.
      date: `${year}-10-31`,
      kind: 'income_tax',
      title: { en: `Income tax return (Form 11, ${year - 1}) and preliminary tax ${year}` },
      appliesTo: 'self-employed individuals',
    },
  );
  return out.sort((a, b) => a.date.localeCompare(b.date));
}
