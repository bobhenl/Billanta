import { easterSunday } from '../../public-holidays.js';
import type { CountryTaxDeadline } from '../types.js';

/**
 * Federal holidays and federal tax deadlines. Local calendar dates, like
 * `public-holidays.ts`.
 */

function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const ymd = (year: number, month: number, day: number) => iso(new Date(year, month - 1, day));

/** The `n`-th `weekday` (0 = Sunday) of a 1-based month. */
function nthWeekday(year: number, month: number, weekday: number, n: number): string {
  const first = new Date(year, month - 1, 1).getDay();
  return ymd(year, month, 1 + ((weekday - first + 7) % 7) + (n - 1) * 7);
}

/**
 * General holidays of the Canada Labour Code, s. 166 (federally regulated
 * employers): New Year's Day, Good Friday, Victoria Day (the Monday before
 * 25 May), Canada Day, Civic Holiday (first Monday of August), Labour Day,
 * National Day for Truth and Reconciliation (30 Sep, since 2021),
 * Thanksgiving (second Monday of October), Remembrance Day, Christmas Day
 * and Boxing Day. Canada Day moves to 2 July when 1 July is a Sunday
 * (Holidays Act, s. 2). Other weekend substitutions depend on the employer
 * and are left out.
 * https://laws-lois.justice.gc.ca/eng/acts/L-2/section-166.html
 *
 * Provincial holidays (Family Day in February in most provinces, Québec's
 * Fête nationale on 24 June and Journée nationale des patriotes, Easter
 * Monday in some provinces…) differ per province and are not in this list.
 */
export function caFederalHolidays(year: number): string[] {
  const easter = easterSunday(year);
  const goodFriday = iso(new Date(easter.getFullYear(), easter.getMonth(), easter.getDate() - 2));
  // Monday strictly before 25 May: 18–24 May.
  const may25 = new Date(year, 4, 25).getDay();
  const victoriaDay = ymd(year, 5, 25 - ((may25 + 6) % 7 || 7));
  const canadaDay = new Date(year, 6, 1).getDay() === 0 ? ymd(year, 7, 2) : ymd(year, 7, 1);
  return [
    ymd(year, 1, 1),
    goodFriday,
    victoriaDay,
    canadaDay,
    nthWeekday(year, 8, 1, 1),
    nthWeekday(year, 9, 1, 1),
    ...(year >= 2021 ? [ymd(year, 9, 30)] : []),
    nthWeekday(year, 10, 1, 2),
    ymd(year, 11, 11),
    ymd(year, 12, 25),
    ymd(year, 12, 26),
  ].sort();
}

/**
 * CRA treats a payment or return as on time when the due date falls on a
 * Saturday, Sunday or public holiday and it arrives the next business day.
 * https://www.canada.ca/en/revenue-agency/services/about-canada-revenue-agency-cra/when-you-pay-file-your-taxes-due-dates.html
 */
export function nextCaBusinessDay(date: string): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  for (let i = 0; ; i++) {
    const cur = new Date(y, m - 1, d + i);
    const s = iso(cur);
    const wd = cur.getDay();
    if (wd !== 0 && wd !== 6 && !caFederalHolidays(cur.getFullYear()).includes(s)) return s;
  }
}

const endOfMonth = (year: number, month: number) => iso(new Date(year, month, 0));

/**
 * Federal deadlines that fall in `year`:
 * - GST/HST return and payment, monthly and quarterly filers: one month
 *   after the end of the reporting period (ETA s. 238(1)(a), s. 238(1)(b)).
 * - Annual filers who are individuals with business income and a
 *   31 December year-end: return by 15 June (ETA s. 238(1)(c)), payment by
 *   30 April (ETA s. 238(1)(c) and s. 228).
 * - T1 personal return: 30 April; self-employed (and their spouse) 15 June,
 *   with any balance still owed by 30 April (ITA s. 150(1)(d)).
 * https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/gst-hst-businesses/file-gst-hst-return/when-file-gst-hst-return.html
 *
 * Provincial deadlines (PST in BC, SK, MB; QST in Québec) and corporate T2
 * (six months after year-end) depend on the province or the fiscal year
 * and are not listed.
 */
export function caFederalDeadlines(year: number): CountryTaxDeadline[] {
  const out: CountryTaxDeadline[] = [];
  for (let month = 1; month <= 12; month++) {
    out.push({
      date: nextCaBusinessDay(endOfMonth(year, month)),
      kind: 'gst_hst_return_monthly',
      title: { en: 'GST/HST return and payment (monthly)', fr: 'Déclaration et paiement de TPS/TVH (mensuel)' },
      appliesTo: 'monthly GST/HST filers, for the previous month',
    });
  }
  for (const month of [1, 4, 7, 10]) {
    out.push({
      date: nextCaBusinessDay(endOfMonth(year, month)),
      kind: 'gst_hst_return_quarterly',
      title: { en: 'GST/HST return and payment (quarterly)', fr: 'Déclaration et paiement de TPS/TVH (trimestriel)' },
      appliesTo: 'quarterly GST/HST filers on calendar quarters, for the previous quarter',
    });
  }
  out.push(
    {
      date: nextCaBusinessDay(ymd(year, 4, 30)),
      kind: 'gst_hst_payment_annual',
      title: { en: 'GST/HST payment (annual filers)', fr: 'Paiement de TPS/TVH (déclarants annuels)' },
      appliesTo: 'individuals with business income, 31 December year-end, annual filing',
    },
    {
      date: nextCaBusinessDay(ymd(year, 6, 15)),
      kind: 'gst_hst_return_annual',
      title: { en: 'GST/HST return (annual filers)', fr: 'Déclaration de TPS/TVH (déclarants annuels)' },
      appliesTo: 'individuals with business income, 31 December year-end, annual filing',
    },
    {
      date: nextCaBusinessDay(ymd(year, 4, 30)),
      kind: 'income_tax_t1',
      title: { en: 'Personal income tax return and balance owing', fr: 'Déclaration de revenus et solde dû des particuliers' },
      appliesTo: 'individuals; also the payment date for the self-employed',
    },
    {
      date: nextCaBusinessDay(ymd(year, 6, 15)),
      kind: 'income_tax_t1_self_employed',
      title: { en: 'Personal income tax return (self-employed)', fr: 'Déclaration de revenus (travailleurs autonomes)' },
      appliesTo: 'self-employed individuals and their spouse or common-law partner',
    },
  );
  return out.sort((a, b) => a.date.localeCompare(b.date));
}
