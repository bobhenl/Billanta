import type { CountryTaxDeadline } from '../types.js';

/**
 * Bank holidays as published by the Bank of Thailand (Notifications
 * No. 31/2568 for 2026 and No. 37/2569 for 2027), already moved to the
 * substitute weekday. The Buddhist holidays follow the lunar calendar and the
 * cabinet adds special days every year, so only published years are listed.
 * The Bangkok-only special holiday on 2026-10-16 is left out.
 */
const PUBLISHED: Readonly<Record<number, readonly string[]>> = {
  2026: [
    '2026-01-01', '2026-01-02', '2026-03-03', '2026-04-06', '2026-04-13', '2026-04-14',
    '2026-04-15', '2026-05-01', '2026-05-04', '2026-06-01', '2026-06-03', '2026-07-28',
    '2026-07-29', '2026-08-12', '2026-10-13', '2026-10-23', '2026-12-07', '2026-12-10',
    '2026-12-31',
  ],
  2027: [
    '2027-01-01', '2027-02-22', '2027-04-06', '2027-04-13', '2027-04-14', '2027-04-15',
    '2027-05-03', '2027-05-04', '2027-05-20', '2027-06-03', '2027-07-19', '2027-07-28',
    '2027-08-12', '2027-10-13', '2027-10-25', '2027-12-06', '2027-12-10', '2027-12-31',
  ],
};

/** Solar-calendar holidays, without substitutes – a fallback for unpublished years. */
const FIXED = ['01-01', '04-06', '04-13', '04-14', '04-15', '05-01', '05-04', '06-03', '07-28', '08-12', '10-13', '10-23', '12-05', '12-10', '12-31'];

export function thHolidays(year: number): string[] {
  return [...(PUBLISHED[year] ?? FIXED.map((md) => `${year}-${md}`))];
}

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * P.P.30 is due by the 15th of the following month on paper (Revenue Code
 * s. 83) or the 23rd when filed online (8-day extension, MoF Notification
 * No. 7 of 2024-01-12, valid to 2027-01-31). Personal income tax (P.N.D.90/91)
 * is due 31 March, 8 April online. Dates are not moved off weekends: the RD
 * announces its own shifts.
 */
export function thDeadlines(year: number): CountryTaxDeadline[] {
  const out: CountryTaxDeadline[] = [];
  for (let m = 1; m <= 12; m++) {
    out.push({
      date: `${year}-${pad(m)}-15`,
      kind: 'vat_return',
      title: { th: 'ยื่นแบบ ภ.พ.30 (กระดาษ)', en: 'VAT return P.P.30 (paper)' },
      appliesTo: 'VAT-registered businesses, previous month',
    });
    out.push({
      date: `${year}-${pad(m)}-23`,
      kind: 'vat_return_efiling',
      title: { th: 'ยื่นแบบ ภ.พ.30 (ออนไลน์)', en: 'VAT return P.P.30 (e-filing)' },
      appliesTo: 'VAT-registered businesses filing online, previous month',
    });
  }
  out.push({
    date: `${year}-03-31`,
    kind: 'income_tax_individual',
    title: { th: 'ยื่นแบบ ภ.ง.ด.90/91 (กระดาษ)', en: 'Personal income tax return P.N.D.90/91 (paper)' },
    appliesTo: 'individuals, previous calendar year',
  });
  out.push({
    date: `${year}-04-08`,
    kind: 'income_tax_individual_efiling',
    title: { th: 'ยื่นแบบ ภ.ง.ด.90/91 (ออนไลน์)', en: 'Personal income tax return P.N.D.90/91 (e-filing)' },
    appliesTo: 'individuals filing online, previous calendar year',
  });
  return out.sort((a, b) => a.date.localeCompare(b.date));
}
