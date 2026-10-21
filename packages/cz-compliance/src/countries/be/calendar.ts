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
 * The ten legal public holidays (wet van 4 januari 1974 betreffende de
 * feestdagen; KB 18 april 1974 art. 1). Community holidays (11 July,
 * 27 September, 15 November) are not general days off.
 */
export function beHolidays(year: number): string[] {
  return [
    iso(year, 1, 1),
    easterPlus(year, 1),
    iso(year, 5, 1),
    easterPlus(year, 39),
    easterPlus(year, 50),
    iso(year, 7, 21),
    iso(year, 8, 15),
    iso(year, 11, 1),
    iso(year, 11, 11),
    iso(year, 12, 25),
  ].sort();
}

/**
 * VAT deadlines (Royal Decree no. 1 art. 18 as amended by the law of
 * 2024 on the VAT chain): monthly returns and payment by the 20th of the
 * next month, quarterly returns by the 25th after the quarter (since 2025),
 * annual client listing by 31 March. Nominal dates; see the pack caveats
 * for the weekend rule.
 */
export function beDeadlines(year: number): CountryTaxDeadline[] {
  const out: CountryTaxDeadline[] = [];
  for (let m = 1; m <= 12; m++) {
    out.push({
      date: iso(year, m, 20),
      kind: 'vat_return_monthly',
      title: {
        nl: 'Maandelijkse btw-aangifte en betaling',
        fr: 'Déclaration et paiement mensuels de la TVA',
        en: 'Monthly VAT return and payment',
      },
      appliesTo: 'monthly VAT filers, for the previous month',
    });
  }
  for (const m of [1, 4, 7, 10]) {
    out.push({
      date: iso(year, m, 25),
      kind: 'vat_return_quarterly',
      title: {
        nl: 'Driemaandelijkse btw-aangifte',
        fr: 'Déclaration trimestrielle de TVA',
        en: 'Quarterly VAT return',
      },
      appliesTo: 'quarterly VAT filers, for the previous quarter',
    });
  }
  out.push({
    date: iso(year, 3, 31),
    kind: 'client_listing',
    title: {
      nl: 'Jaarlijkse klantenlisting',
      fr: 'Listing annuel des clients assujettis',
      en: 'Annual client listing',
    },
    appliesTo: 'VAT-registered businesses, for the previous year',
  });
  return out.sort((a, b) => a.date.localeCompare(b.date));
}
