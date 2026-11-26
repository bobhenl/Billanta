import { easterSunday } from '../../public-holidays.js';
import type { CountryTaxDeadline } from '../types.js';

const iso = (y: number, m: number, d: number): string =>
  `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

function easterPlus(year: number, days: number): string {
  const e = easterSunday(year);
  const d = new Date(e.getFullYear(), e.getMonth(), e.getDate() + days);
  return iso(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

/**
 * Legal public holidays (Code du travail art. L.232-2; Europe Day 9 May
 * added by the law of 26 April 2019).
 */
export function luHolidays(year: number): string[] {
  return [
    iso(year, 1, 1),
    easterPlus(year, 1),
    iso(year, 5, 1),
    ...(year >= 2019 ? [iso(year, 5, 9)] : []),
    easterPlus(year, 39),
    easterPlus(year, 50),
    iso(year, 6, 23),
    iso(year, 8, 15),
    iso(year, 11, 1),
    iso(year, 12, 25),
    iso(year, 12, 26),
  ].sort();
}

/**
 * VAT returns (loi TVA art. 64; RGD du 1er décembre 2017): monthly and
 * quarterly returns by the 15th of the month after the period, the annual
 * return by 1 May of the following year.
 */
export function luDeadlines(year: number): CountryTaxDeadline[] {
  const out: CountryTaxDeadline[] = [];
  for (let m = 1; m <= 12; m++) {
    out.push({
      date: iso(year, m, 15),
      kind: 'vat_return_monthly',
      title: { fr: 'Déclaration mensuelle de TVA', de: 'Monatliche MwSt-Erklärung', en: 'Monthly VAT return' },
      appliesTo: 'monthly filers (turnover over EUR 620,000), for the previous month',
    });
  }
  for (const m of [1, 4, 7, 10]) {
    out.push({
      date: iso(year, m, 15),
      kind: 'vat_return_quarterly',
      title: { fr: 'Déclaration trimestrielle de TVA', de: 'Vierteljährliche MwSt-Erklärung', en: 'Quarterly VAT return' },
      appliesTo: 'quarterly filers (turnover EUR 112,000–620,000), for the previous quarter',
    });
  }
  out.push({
    date: iso(year, 5, 1),
    kind: 'vat_return_annual',
    title: { fr: 'Déclaration annuelle de TVA', de: 'Jährliche MwSt-Erklärung', en: 'Annual VAT return' },
    appliesTo: 'every VAT-registered business, for the previous year',
  });
  return out.sort((a, b) => a.date.localeCompare(b.date));
}
