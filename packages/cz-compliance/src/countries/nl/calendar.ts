import { easterSunday } from '../../public-holidays.js';
import type { CountryTaxDeadline } from '../types.js';

const iso = (y: number, m: number, d: number): string =>
  `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

function easterPlus(year: number, days: number): string {
  const e = easterSunday(year);
  const d = new Date(e.getFullYear(), e.getMonth(), e.getDate() + days);
  return iso(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

const lastDay = (year: number, month: number): number => new Date(year, month, 0).getDate();

/**
 * Days that extend a legal term (Algemene termijnenwet art. 3): New Year,
 * Good Friday, Easter Monday, King's Day, 5 May, Ascension, Whit Monday and
 * both Christmas days. King's Day moves to 26 April when 27 April is a
 * Sunday (Besluit van 2013 over de viering van Koningsdag). Easter Sunday and
 * Whit Sunday are Sundays anyway. Whether employees get Good Friday or
 * 5 May off depends on the collective agreement.
 */
export function nlHolidays(year: number): string[] {
  const kingsDay = new Date(year, 3, 27).getDay() === 0 ? iso(year, 4, 26) : iso(year, 4, 27);
  return [
    iso(year, 1, 1),
    easterPlus(year, -2),
    easterPlus(year, 1),
    kingsDay,
    iso(year, 5, 5),
    easterPlus(year, 39),
    easterPlus(year, 50),
    iso(year, 12, 25),
    iso(year, 12, 26),
  ].sort();
}

/**
 * VAT returns are due by the last day of the month after the period (Wet OB
 * art. 14, AWR art. 19). Quarterly is the default; monthly on request.
 * Income tax return by 1 May (AWR art. 9; extension via an adviser).
 */
export function nlDeadlines(year: number): CountryTaxDeadline[] {
  const out: CountryTaxDeadline[] = [];
  for (const m of [1, 4, 7, 10]) {
    out.push({
      date: iso(year, m, lastDay(year, m)),
      kind: 'vat_return_quarterly',
      title: { nl: 'Btw-aangifte (kwartaal)', en: 'Quarterly VAT return' },
      appliesTo: 'quarterly VAT filers (default), for the previous quarter; ICP declaration on the same day',
    });
  }
  for (let m = 1; m <= 12; m++) {
    out.push({
      date: iso(year, m, lastDay(year, m)),
      kind: 'vat_return_monthly',
      title: { nl: 'Btw-aangifte (maand)', en: 'Monthly VAT return' },
      appliesTo: 'monthly VAT filers, for the previous month',
    });
  }
  out.push({
    date: iso(year, 5, 1),
    kind: 'income_tax_return',
    title: { nl: 'Aangifte inkomstenbelasting', en: 'Income tax return' },
    appliesTo: 'sole traders (zzp), for the previous year; later with an extension',
  });
  return out.sort((a, b) => a.date.localeCompare(b.date));
}
