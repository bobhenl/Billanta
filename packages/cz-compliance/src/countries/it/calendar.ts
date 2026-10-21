import { easterSunday } from '../../public-holidays.js';
import type { CountryTaxDeadline } from '../types.js';

const iso = (y: number, m: number, d: number) =>
  `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

function plusDays(date: Date, days: number): string {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
  return iso(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

/**
 * National public holidays: L. 260/1949 as amended by L. 54/1977 and DPR
 * 792/1985 (Epiphany restored), plus 4 October (San Francesco d'Assisi)
 * from 2026 under L. 151/2025. Local patron saints' days are not national.
 */
export function italyHolidays(year: number): string[] {
  const easter = easterSunday(year);
  const days = [
    iso(year, 1, 1),
    iso(year, 1, 6),
    plusDays(easter, 0),
    plusDays(easter, 1),
    iso(year, 4, 25),
    iso(year, 5, 1),
    iso(year, 6, 2),
    iso(year, 8, 15),
    ...(year >= 2026 ? [iso(year, 10, 4)] : []),
    iso(year, 11, 1),
    iso(year, 12, 8),
    iso(year, 12, 25),
    iso(year, 12, 26),
  ];
  return [...new Set(days)].sort();
}

/**
 * Moves a tax deadline the way Italian law does:
 * - payments falling 1–20 August move to 20 August (art. 3-quater DL 16/2012);
 * - a deadline on a Saturday, Sunday or holiday moves to the next working day
 *   (art. 7 c. 1 lett. h DL 70/2011, art. 18 D.Lgs. 241/1997 for F24).
 */
export function italyDeadlineDate(year: number, month: number, day: number, payment = false): string {
  if (payment && month === 8 && day <= 20) day = 20;
  const holidays = new Set(italyHolidays(year));
  const d = new Date(year, month - 1, day);
  while (d.getDay() === 0 || d.getDay() === 6 || holidays.has(iso(d.getFullYear(), d.getMonth() + 1, d.getDate()))) {
    d.setDate(d.getDate() + 1);
  }
  return iso(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

const lastDay = (y: number, m: number) => new Date(y, m, 0).getDate();

/**
 * Main VAT and stamp-duty deadlines of `year`. Source: Agenzia delle Entrate
 * scadenzario; art. 1 DPR 100/1998 (monthly), art. 7 DPR 542/1999 (quarterly,
 * +1 % interest), art. 6 L. 405/1990 (acconto 27 December), art. 21-bis DL
 * 78/2010 (LIPE: last day of the 2nd month after the quarter, Q2 by 30
 * September, Q4 by end of February), art. 8 DPR 322/1998 (annual return by
 * 30 April), DM 17 June 2014 art. 6 as amended by DM 4 December 2020 (bollo).
 */
export function italyDeadlines(year: number): CountryTaxDeadline[] {
  const out: CountryTaxDeadline[] = [];

  for (let m = 1; m <= 12; m++) {
    out.push({
      date: italyDeadlineDate(year, m, 16, true),
      kind: 'vat_payment_monthly',
      title: { it: 'Versamento IVA mensile (F24)', en: 'Monthly VAT payment (F24)' },
      appliesTo: 'monthly VAT filers – VAT of the previous month',
    });
  }

  // Q4 of the previous year is settled with the annual balance by 16 March.
  for (const [m, d] of [[3, 16], [5, 16], [8, 20], [11, 16]] as const) {
    out.push({
      date: italyDeadlineDate(year, m, d, true),
      kind: 'vat_payment_quarterly',
      title: { it: 'Versamento IVA trimestrale (F24)', en: 'Quarterly VAT payment (F24)' },
      appliesTo: m === 3 ? 'quarterly filers – Q4 of last year and the annual balance' : 'quarterly VAT filers',
    });
  }

  out.push({
    date: italyDeadlineDate(year, 12, 27, true),
    kind: 'vat_advance',
    title: { it: 'Acconto IVA', en: 'VAT advance payment' },
    appliesTo: 'VAT payers (not forfettari)',
  });

  for (const [m, d] of [[2, lastDay(year, 2)], [5, 31], [9, 30], [11, 30]] as const) {
    out.push({
      date: italyDeadlineDate(year, m, d),
      kind: 'vat_lipe',
      title: { it: 'Comunicazione liquidazioni periodiche IVA (LIPE)', en: 'Periodic VAT settlement report (LIPE)' },
      appliesTo: 'VAT payers (not forfettari)',
    });
  }

  out.push({
    date: italyDeadlineDate(year, 4, 30),
    kind: 'vat_return',
    title: { it: 'Dichiarazione IVA annuale', en: 'Annual VAT return' },
    appliesTo: 'VAT payers – return for the previous year',
  });

  for (const [m, d] of [[2, lastDay(year, 2)], [5, 31], [9, 30], [11, 30]] as const) {
    out.push({
      date: italyDeadlineDate(year, m, d, true),
      kind: 'stamp_duty',
      title: { it: 'Imposta di bollo sulle fatture elettroniche (F24)', en: 'Stamp duty on e-invoices (F24)' },
      appliesTo: 'issuers of invoices with VAT-free amounts above EUR 77.47',
    });
  }

  return out.sort((a, b) => a.date.localeCompare(b.date));
}
