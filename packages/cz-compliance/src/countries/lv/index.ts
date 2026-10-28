import type { CountryPack, CountryTaxDeadline, Source, TaxRate } from '../types.js';
import { easterOffset, isoList, nextWorkingDay, ymd } from '../se/calendar.js';
import { isValidLvRegNr, isValidLvVat, normalizeLvRegNr, normalizeLvVat } from './ids.js';

export * from './ids.js';

const PVN: Source = {
  title: 'Pievienotās vērtības nodokļa likums (likumi.lv)',
  url: 'https://likumi.lv/ta/id/253451-pievienotas-vertibas-nodokla-likums',
};
const VID_PVN: Source = {
  title: 'VID – Pievienotās vērtības nodoklis',
  url: 'https://www.vid.gov.lv/lv/pievienotas-vertibas-nodoklis',
};
const EINVOICE: Source = {
  title: 'VID – E-rēķini (Grāmatvedības likuma grozījumi, B2B no 2028-01-01)',
  url: 'https://www.vid.gov.lv/lv/e-rekini',
};
const FOOD_12: Source = {
  title: 'Saeima – Reduced 12 % VAT on bread, milk, poultry and eggs (1 Jul 2026 – 30 Jun 2027)',
  url: 'https://www.saeima.lv/en/news/saeima-news',
};
const SVETKU: Source = {
  title: 'Likums "Par svētku, atceres un atzīmējamām dienām" (likumi.lv)',
  url: 'https://likumi.lv/ta/id/42442-par-svetku-atceres-un-atzimejamam-dienam',
};
const UR: Source = { title: 'Uzņēmumu reģistrs', url: 'https://www.ur.gov.lv' };

/** 4 May and 18 November move to the next Monday when they fall on a weekend. */
const nationalDay = (year: number, month: number, day: number): Date => {
  const d = ymd(year, month, day);
  if (d.getDay() === 6) d.setDate(d.getDate() + 2);
  else if (d.getDay() === 0) d.setDate(d.getDate() + 1);
  return d;
};

/** Svētku dienas of the holiday law, § 1. */
function holidays(year: number): string[] {
  return isoList([
    ymd(year, 1, 1),
    easterOffset(year, -2), // Lielā Piektdiena
    easterOffset(year, 0),
    easterOffset(year, 1),
    ymd(year, 5, 1),
    ymd(year, 5, 4), // Neatkarības atjaunošanas diena
    nationalDay(year, 5, 4),
    easterOffset(year, 49), // Vasarsvētki
    ymd(year, 6, 23), // Līgo
    ymd(year, 6, 24), // Jāņi
    ymd(year, 11, 18), // Proklamēšanas diena
    nationalDay(year, 11, 18),
    ymd(year, 12, 24),
    ymd(year, 12, 25),
    ymd(year, 12, 26),
    ymd(year, 12, 31),
  ]);
}

/**
 * PVN deklarācija and payment: the 20th of the month after a monthly or
 * quarterly period (PVN likums 117. pants), moved to the next working day.
 */
function deadlines(year: number): CountryTaxDeadline[] {
  const off = holidays(year);
  const monthly = Array.from({ length: 12 }, (_, i) => ({
    date: nextWorkingDay(ymd(year, i + 1, 20), off),
    kind: 'vat_return_monthly',
    title: { lv: 'PVN deklarācija (mēnesis)', en: 'VAT return (monthly)' },
    appliesTo: 'monthly filers (previous month)',
  }));
  const quarterly = [1, 4, 7, 10].map((m) => ({
    date: nextWorkingDay(ymd(year, m, 20), off),
    kind: 'vat_return_quarterly',
    title: { lv: 'PVN deklarācija (ceturksnis)', en: 'VAT return (quarterly)' },
    appliesTo: 'quarterly filers (previous quarter)',
  }));
  return [...monthly, ...quarterly].sort((a, b) => a.date.localeCompare(b.date));
}

const ZERO: TaxRate = { rate: 0, kind: 'zero', appliesTo: 'intra-EU supplies, exports' };
const FIVE: TaxRate = { rate: 5, kind: 'super_reduced', appliesTo: 'fresh fruit, berries and vegetables; books and press' };
const TWELVE: TaxRate = {
  rate: 12,
  kind: 'reduced',
  appliesTo: 'medicines and medical devices, passenger transport, accommodation, heating, baby food',
};

export const LV: CountryPack = {
  code: 'LV',
  name: 'Latvia',
  region: 'eu',
  euMember: true,
  currency: 'EUR',
  currencyMinorUnits: 2,
  timeZone: 'Europe/Riga',
  locales: ['lv', 'en'],
  taxIds: [
    {
      kind: 'company',
      label: { lv: 'Reģistrācijas numurs', en: 'Registration number' },
      example: '40003521600',
      normalize: normalizeLvRegNr,
      validate: isValidLvRegNr,
      requiredOnInvoice: false,
      source: UR,
    },
    {
      kind: 'vat',
      label: { lv: 'PVN reģistrācijas numurs', en: 'VAT number' },
      example: 'LV40003521600',
      normalize: normalizeLvVat,
      validate: isValidLvVat,
      // PVN likums 125. panta 1. daļa: the seller's (and the registered buyer's) VAT number.
      requiredOnInvoice: true,
      source: VID_PVN,
    },
  ],
  indirectTax: {
    kind: 'vat',
    name: { lv: 'Pievienotās vērtības nodoklis (PVN)', en: 'VAT' },
    // PVN likums 41. pants (standard), 42. pants (reduced).
    rateSets: [
      { validFrom: '2018-01-01', rates: [{ rate: 21, kind: 'standard' }, TWELVE, FIVE, ZERO] },
      {
        validFrom: '2026-07-01',
        rates: [
          { rate: 21, kind: 'standard' },
          {
            ...TWELVE,
            appliesTo: `${TWELVE.appliesTo}; bread, milk (not UHT), fresh poultry and eggs (temporary)`,
          },
          FIVE,
          ZERO,
        ],
      },
      { validFrom: '2027-07-01', rates: [{ rate: 21, kind: 'standard' }, TWELVE, FIVE, ZERO] },
    ],
    smallBusiness: {
      // PVN likums 59. pants: registration required above EUR 50,000 in the current or previous calendar year.
      threshold: 50_000,
      currency: 'EUR',
      invoiceNote: {
        lv: 'Piegādātājs nav reģistrēts VID PVN maksātāju reģistrā.',
        en: 'The supplier is not registered for VAT in Latvia.',
      },
      source: VID_PVN,
    },
    reverseChargeNote: {
      domestic: { lv: 'Nodokļa apgrieztā maksāšana', en: 'Reverse charge' },
      crossBorder: { lv: 'Nodokļa apgrieztā maksāšana', en: 'Reverse charge' },
    },
    source: PVN,
  },
  invoice: {
    // PVN likums 125. pants (nodokļa rēķina rekvizīti).
    requirements: [
      { field: 'document_title', rule: 'PVN likums 125. p. 1. d. 1. pkt.' },
      { field: 'invoice_number', rule: 'PVN likums 125. p. 1. d. 2. pkt.' },
      { field: 'issue_date', rule: 'PVN likums 125. p. 1. d. 3. pkt.' },
      { field: 'supplier_name', rule: 'PVN likums 125. p. 1. d. 4. pkt.' },
      { field: 'supplier_address', rule: 'PVN likums 125. p. 1. d. 4. pkt.' },
      { field: 'supplier_vat_id', rule: 'PVN likums 125. p. 1. d. 4. pkt.' },
      { field: 'customer_name', rule: 'PVN likums 125. p. 1. d. 5. pkt.' },
      { field: 'customer_address', rule: 'PVN likums 125. p. 1. d. 5. pkt.' },
      { field: 'customer_vat_id', when: 'b2b', rule: 'PVN likums 125. p. 1. d. 5. pkt.' },
      { field: 'supply_date', rule: 'PVN likums 125. p. 1. d. 6. pkt.' },
      { field: 'line_description', rule: 'PVN likums 125. p. 1. d. 7. pkt.' },
      { field: 'line_quantity', rule: 'PVN likums 125. p. 1. d. 7. pkt.' },
      { field: 'line_unit_price', rule: 'PVN likums 125. p. 1. d. 8. pkt.' },
      { field: 'tax_rate_per_line', rule: 'PVN likums 125. p. 1. d. 9. pkt.' },
      { field: 'tax_amount_per_rate', rule: 'PVN likums 125. p. 1. d. 10. pkt.' },
      { field: 'tax_in_local_currency', rule: 'PVN likums 125. p. (VAT in euros)' },
    ],
    title: { standard: { lv: 'Rēķins', en: 'Invoice' } },
    numbering: { gapless: false, multipleSeries: true },
    homeCurrencyTaxRequired: true,
    // Grāmatvedības likums 10. pants: source documents for 5 years.
    retentionYears: 5,
    source: PVN,
  },
  einvoicing: [
    {
      scope: 'b2g',
      model: 'peppol_exchange',
      from: '2025-01-01',
      appliesTo: 'invoices to Latvian public authorities (Grāmatvedības likums)',
      formats: ['peppol_bis'],
      platform: 'e-adrese / Peppol',
      source: EINVOICE,
    },
    {
      scope: 'b2b',
      model: 'peppol_exchange',
      from: '2028-01-01',
      appliesTo: 'all VAT-registered businesses (postponed from 2026; voluntary since 30 Mar 2026)',
      formats: ['peppol_bis'],
      platform: 'e-adrese / Peppol, with reporting to VID',
      source: EINVOICE,
    },
  ],
  payments: {
    iban: true,
    qr: ['epc'],
    reference: 'free_text',
    localMethods: ['sepa'],
  },
  registry: { name: 'Uzņēmumu reģistrs (Lursoft / UR)', url: 'https://www.ur.gov.lv' },
  holidays,
  deadlines,
  supportLevel: 'pack',
  verifiedAt: '2026-10-28',
  caveats: [
    'The temporary 12 % on bread, milk, poultry and eggs (2026-07-01 to 2027-06-30) is from news coverage; the exact product scope is not confirmed.',
    'The item lists of the 12 % and 5 % rates are summarised from memory.',
    'PVN likums article numbers (41, 42, 59, 117, 125) and item numbering are from memory.',
    'Whether the 2028 B2B mandate adds real-time reporting to VID (beyond Peppol exchange) is not settled.',
    'Source deep links (VID e-rēķini, Saeima news) are landing pages, not the exact articles.',
    'Latvia also has one-off moved working days (Cabinet orders); they are not modelled.',
  ],
  sources: [PVN, VID_PVN, EINVOICE, FOOD_12, SVETKU, UR],
};
