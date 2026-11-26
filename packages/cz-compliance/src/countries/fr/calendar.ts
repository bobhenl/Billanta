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
 * Jours fériés, Code du travail art. L3133-1. Whit Monday stays a public
 * holiday even though many employers use it as the journée de solidarité
 * (L3133-7). Alsace-Moselle adds Good Friday and 26 December (L3134-13) –
 * not included, see the pack caveats.
 */
export function frHolidays(year: number): string[] {
  return [
    iso(year, 1, 1),
    easterPlus(year, 1),
    iso(year, 5, 1),
    iso(year, 5, 8),
    easterPlus(year, 39),
    easterPlus(year, 50),
    iso(year, 7, 14),
    iso(year, 8, 15),
    iso(year, 11, 1),
    iso(year, 11, 11),
    iso(year, 12, 25),
  ].sort();
}

/** The `n`-th working day after `from` (exclusive), skipping weekends and holidays. */
function nthWorkingDayAfter(year: number, month: number, day: number, n: number): string {
  const holidays = new Set(frHolidays(year));
  const d = new Date(year, month - 1, day);
  let left = n;
  while (left > 0) {
    d.setDate(d.getDate() + 1);
    const s = iso(d.getFullYear(), d.getMonth() + 1, d.getDate());
    if (d.getDay() !== 0 && d.getDay() !== 6 && !holidays.has(s)) left--;
  }
  return iso(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

/**
 * Main VAT and micro-entrepreneur deadlines (impots.gouv.fr calendrier
 * fiscal; CGI ann. IV art. 39 for CA3 dates, art. 242 sexies for CA12).
 * The CA3 day is fixed per business between the 15th and the 24th by legal
 * form and SIREN; the 24th is the latest possible one.
 */
export function frDeadlines(year: number): CountryTaxDeadline[] {
  const out: CountryTaxDeadline[] = [];
  for (let m = 1; m <= 12; m++) {
    out.push({
      date: iso(year, m, 24),
      kind: 'vat_return_ca3',
      title: { fr: 'Déclaration de TVA CA3 (mensuelle)', en: 'Monthly VAT return (CA3)' },
      appliesTo: 'monthly filers under the réel normal regime; actual day 15th–24th by legal form and SIREN',
    });
  }
  out.push({
    date: nthWorkingDayAfter(year, 5, 1, 2),
    kind: 'vat_return_ca12',
    title: { fr: 'Déclaration annuelle de TVA CA12', en: 'Annual VAT return (CA12)' },
    appliesTo: 'businesses under the réel simplifié regime, for the previous calendar year',
  });
  for (const [m, d] of [[1, 31], [4, 30], [7, 31], [10, 31]] as const) {
    out.push({
      date: iso(year, m, d),
      kind: 'urssaf_turnover',
      title: {
        fr: "Déclaration de chiffre d'affaires micro-entrepreneur (trimestrielle)",
        en: 'Micro-entrepreneur turnover declaration (quarterly)',
      },
      appliesTo: 'micro-entrepreneurs filing quarterly with URSSAF; monthly filers file by the last day of each month',
    });
  }
  out.push({
    date: iso(year, 12, 15),
    kind: 'cfe',
    title: { fr: 'Cotisation foncière des entreprises (CFE)', en: 'Business property tax (CFE)' },
  });
  return out.sort((a, b) => a.date.localeCompare(b.date));
}
