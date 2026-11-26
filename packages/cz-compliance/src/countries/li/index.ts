import type { CountryPack, TaxIdSpec } from '../types.js';
import { easterOffset, ymd } from '../de/dates.js';
import { swissStyleIndirectTax, swissStyleInvoice, vatReturnDeadlines } from '../ch/index.js';

const LI_MWSTG = 'https://www.gesetze.li/konso/2009330000';
const STV = 'https://www.llv.li/de/landesverwaltung/steuerverwaltung';

/**
 * Holidays that Art. 18 Abs. 2 Arbeitsgesetz treats like Sundays: Neujahr,
 * Heilige Drei Könige, Ostermontag, Tag der Arbeit, Auffahrt, Pfingstmontag,
 * Fronleichnam, Staatsfeiertag (15 August), Mariä Geburt, Allerheiligen,
 * Mariä Empfängnis, Weihnachten and Stephanstag.
 */
export function liechtensteinHolidays(year: number): string[] {
  return [
    ymd(year, 1, 1),
    ymd(year, 1, 6),
    easterOffset(year, 1),
    ymd(year, 5, 1),
    easterOffset(year, 39),
    easterOffset(year, 50),
    easterOffset(year, 60),
    ymd(year, 8, 15),
    ymd(year, 9, 8),
    ymd(year, 11, 1),
    ymd(year, 12, 8),
    ymd(year, 12, 25),
    ymd(year, 12, 26),
  ].sort();
}

const compact = (value: string) => value.replace(/[\s.\-]/g, '').toUpperCase();

/** MWST number issued by the Steuerverwaltung; 5–6 digits, with an optional "FL"/"LI" prefix. Format only, see caveats. */
export function isValidLiMwstNumber(value: string): boolean {
  return /^\d{5,6}$/.test(compact(value).replace(/^(FL|LI)/, '').replace(/MWST$/, ''));
}

/** Handelsregister: "FL-0002.123.456-7". Format only; the check-digit method is not published. */
export function isValidLiRegisterNumber(value: string): boolean {
  return /^FL\d{11}$/.test(compact(value));
}

const LI_TAX_IDS: readonly TaxIdSpec[] = [
  {
    kind: 'vat',
    label: { de: 'MWST-Nr.', en: 'VAT number' },
    example: '12345',
    normalize: (v) => compact(v).replace(/^(FL|LI)/, '').replace(/MWST$/, ''),
    validate: isValidLiMwstNumber,
    // Art. 26 Abs. 2 lit. a LI-MWSTG: the number under which the supplier is registered.
    requiredOnInvoice: true,
    source: { title: 'Art. 26 MWSTG (LI)', url: LI_MWSTG },
  },
  {
    kind: 'company',
    label: { de: 'Handelsregisternummer', en: 'Commercial register number' },
    example: 'FL-0002.123.456-7',
    normalize: (v) => {
      const c = compact(v);
      return /^FL\d{11}$/.test(c) ? `FL-${c.slice(2, 6)}.${c.slice(6, 9)}.${c.slice(9, 12)}-${c.slice(12)}` : v.trim();
    },
    validate: isValidLiRegisterNumber,
    requiredOnInvoice: false,
    source: { title: 'Handelsregister (Amt für Justiz)', url: 'https://www.oera.li/' },
  },
];

export const LI: CountryPack = {
  code: 'LI',
  name: 'Liechtenstein',
  region: 'europe',
  euMember: false,
  // Swiss franc under the 1980 currency treaty with Switzerland.
  currency: 'CHF',
  currencyMinorUnits: 2,
  cashRounding: 0.05,
  timeZone: 'Europe/Vaduz',
  locales: ['de-LI', 'de', 'en'],
  taxIds: LI_TAX_IDS,
  // The Zollvertrag (1923) and the VAT treaty with CH oblige LI to mirror Swiss VAT law and rates (BuA 19/2023).
  indirectTax: swissStyleIndirectTax('MWSTG (LI)', { title: 'Mehrwertsteuergesetz (LI)', url: LI_MWSTG }),
  invoice: { ...swissStyleInvoice({ title: 'Art. 26 MWSTG (LI)', url: LI_MWSTG }), language: { note: 'German is the official language; English is accepted in practice.' } },
  // No e-invoice mandate found for B2B or B2G.
  einvoicing: [],
  payments: {
    iban: true,
    // LI IBANs are supported by the Swiss QR-bill.
    qr: ['swiss_qr'],
    reference: 'sepa_rf',
    localMethods: ['ebill', 'twint', 'lsv', 'card'],
  },
  registry: { name: 'Handelsregister Liechtenstein', url: 'https://www.oera.li/' },
  holidays: liechtensteinHolidays,
  // Same 60-day rule as CH (Art. 71 LI-MWSTG), with Liechtenstein holidays.
  deadlines: (year) => vatReturnDeadlines(year, liechtensteinHolidays),
  supportLevel: 'pack',
  verifiedAt: '2026-10-21',
  caveats: [
    'The MWST number format (5–6 digits) is not confirmed from an official source; check it against mwstregister.li before relying on validation.',
    'The Handelsregister number check digit is not published; format only.',
    'Holidays: Mariä Lichtmess (2 Feb), Josefstag (19 Mar), Karfreitag, Berchtoldstag, Fasnachtsdienstag (afternoon), 24 and 31 December are customary days off but not Sunday-equivalent under Art. 18 Abs. 2 ArG; check against the statute.',
    'Invoice rules are assumed to match Art. 26 MWSTG CH, since the LI-MWSTG mirrors it; the Swiss MWSTV references (Art. 57) may have a different number in the LI ordinance.',
    'No e-invoicing mandate (B2B or B2G) was found; verify with the Landesverwaltung.',
    'Retention: 10 years under Art. 1059 PGR, as in CH.',
  ],
  sources: [
    { title: 'Mehrwertsteuergesetz (LI)', url: LI_MWSTG },
    { title: 'Bericht und Antrag 19/2023 – MWST-Sätze ab 2024', url: 'https://www.llv.li/files/srk/bua_019_2023_bua_abanderung-der-mehrwertsteuer.pdf' },
    { title: 'Steuerverwaltung Liechtenstein', url: STV },
    { title: 'Arbeitsgesetz (LI)', url: 'https://www.gesetze.li/' },
  ],
};
