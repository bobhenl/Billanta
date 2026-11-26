import { easterSunday } from '../../public-holidays.js';
import type { CountryPack, CountryTaxDeadline, Source } from '../types.js';

const VAT_ACT: Source = {
  title: 'Value Added Tax Act, Cap. 406 – Laws of Malta',
  url: 'https://legislation.mt/eli/cap/406/eng',
};
const MTCA_VAT: Source = {
  title: 'VAT – Malta Tax and Customs Administration',
  url: 'https://mtca.gov.mt/vat/',
};
const MTCA_SME: Source = {
  title: 'Explanatory notes – SMEs and VAT (2025), MTCA',
  url: 'https://mtca.gov.mt/docs/default-source/documents/business-tax/vat/other/explanatory-notes/explanatory-notes-smes-vat-2025.pdf',
};
const HOLIDAYS: Source = {
  title: 'Public Holidays – gov.mt',
  url: 'https://www.gov.mt/en/About%20Malta/Pages/Public%20Holidays.aspx',
};

export function normalizeMtVat(value: string): string {
  return value.replace(/[\s.-]/g, '').toUpperCase().replace(/^MT/, '');
}

/**
 * Maltese VAT number: 8 digits, the last two a check number so that the
 * weighted sum (3, 4, 6, 7, 8, 9 on the first six, 10 and 1 on the check
 * pair) is divisible by 37. The algorithm is the one the EU VIES check
 * applies; the MTCA does not publish it.
 */
export function isValidMtVat(value: string): boolean {
  if (!/^[1-9]\d{7}$/.test(value)) return false;
  const weights = [3, 4, 6, 7, 8, 9, 10, 1];
  const sum = weights.reduce((acc, w, i) => acc + w * Number(value[i]), 0);
  return sum % 37 === 0;
}

const iso = (y: number, m: number, d: number) =>
  `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

/**
 * The 14 public holidays of the National Holidays and Other Public Holidays
 * Act (Cap. 252). Since 2025 a holiday on a weekend gives employees an extra
 * day of leave instead of moving the holiday, so dates are never shifted.
 */
export function maltaHolidays(year: number): string[] {
  const easter = easterSunday(year);
  const goodFriday = new Date(easter.getFullYear(), easter.getMonth(), easter.getDate() - 2);
  return [
    iso(year, 1, 1), // New Year's Day
    iso(year, 2, 10), // St Paul's Shipwreck
    iso(year, 3, 19), // St Joseph
    iso(year, 3, 31), // Freedom Day
    iso(year, goodFriday.getMonth() + 1, goodFriday.getDate()),
    iso(year, 5, 1), // Workers' Day
    iso(year, 6, 7), // Sette Giugno
    iso(year, 6, 29), // Sts Peter and Paul (L-Imnarja)
    iso(year, 8, 15), // Assumption
    iso(year, 9, 8), // Our Lady of Victories
    iso(year, 9, 21), // Independence Day
    iso(year, 12, 8), // Immaculate Conception
    iso(year, 12, 13), // Republic Day
    iso(year, 12, 25), // Christmas Day
  ].sort();
}

/**
 * Quarterly VAT return and payment for Article 10 registrants on calendar
 * quarters: due on the 15th of the second month after the quarter when
 * filed electronically (Art. 27 and Eleventh Schedule, Cap. 406; MTCA).
 * Each registrant's periods are set by the MTCA and are often staggered,
 * so these dates fit only calendar-quarter filers.
 */
export function maltaDeadlines(year: number): CountryTaxDeadline[] {
  return [2, 5, 8, 11].map((m) => ({
    date: iso(year, m, 15),
    kind: 'vat_return',
    title: { mt: 'Dikjarazzjoni tal-VAT', en: 'VAT return and payment' },
    appliesTo: 'Article 10 registrants with calendar-quarter tax periods (e-filing)',
  }));
}

export const MT: CountryPack = {
  code: 'MT',
  name: 'Malta',
  region: 'eu',
  euMember: true,
  currency: 'EUR',
  currencyMinorUnits: 2,
  timeZone: 'Europe/Malta',
  locales: ['en', 'mt'],
  taxIds: [
    {
      kind: 'vat',
      label: { mt: 'Numru tal-VAT', en: 'VAT number' },
      // The example the python-stdnum and VIES documentation use.
      example: 'MT11679112',
      normalize: normalizeMtVat,
      validate: isValidMtVat,
      // Cap. 406, Thirteenth Schedule, Part I.
      requiredOnInvoice: true,
      source: VAT_ACT,
    },
  ],
  indirectTax: {
    kind: 'vat',
    name: { mt: 'VAT', en: 'VAT' },
    rateSets: [
      // Standard rate Art. 19 Cap. 406; reduced rates in the Eighth Schedule, zero rate ("exempt with credit") in the Fifth Schedule Part One.
      {
        validFrom: '2019-01-01',
        rates: [
          { rate: 18, kind: 'standard' },
          { rate: 12, kind: 'reduced', appliesTo: 'Custody and management of securities, management of credit and credit guarantees' },
          { rate: 7, kind: 'reduced', appliesTo: 'Holiday accommodation, use of sporting facilities' },
          { rate: 5, kind: 'reduced', appliesTo: 'Electricity, confectionery, medical accessories, printed matter, items for disabled people, cultural events, small repairs' },
          { rate: 0, kind: 'zero', appliesTo: 'Food for human consumption, pharmaceuticals, scheduled passenger transport (exempt with credit)' },
        ],
      },
    ],
    smallBusiness: {
      // Art. 11 Cap. 406 as amended from 1 January 2025: domestic turnover up to EUR 35,000 in the previous year.
      threshold: 35000,
      currency: 'EUR',
      invoiceNote: {
        mt: 'Eżenti mill-VAT skont l-Artikolu 11 tal-Att dwar it-Taxxa fuq il-Valur Miżjud (Kap. 406)',
        en: 'VAT exempt – Article 11 of the Value Added Tax Act (Cap. 406)',
      },
      source: MTCA_SME,
    },
    reverseChargeNote: {
      // Art. 20 and Fourth Schedule Cap. 406 implement art. 196 of Directive 2006/112/EC.
      crossBorder: {
        mt: 'Reverse charge – il-klijent huwa responsabbli għall-VAT',
        en: 'Reverse charge – VAT to be accounted for by the recipient (art. 196 Directive 2006/112/EC)',
      },
    },
    source: VAT_ACT,
  },
  invoice: {
    // Cap. 406, Thirteenth Schedule, Part I (implements art. 226 of Directive 2006/112/EC).
    requirements: [
      { field: 'issue_date', rule: 'Cap. 406 Sch. 13 Part I' },
      { field: 'invoice_number', rule: 'Cap. 406 Sch. 13 Part I – sequential, unique' },
      { field: 'supplier_vat_id', rule: 'Cap. 406 Sch. 13 Part I' },
      { field: 'customer_vat_id', when: 'cross_border', rule: 'Cap. 406 Sch. 13 Part I – when the customer accounts for the VAT' },
      { field: 'supplier_name', rule: 'Cap. 406 Sch. 13 Part I' },
      { field: 'supplier_address', rule: 'Cap. 406 Sch. 13 Part I' },
      { field: 'customer_name', rule: 'Cap. 406 Sch. 13 Part I' },
      { field: 'customer_address', rule: 'Cap. 406 Sch. 13 Part I' },
      { field: 'line_description', rule: 'Cap. 406 Sch. 13 Part I' },
      { field: 'line_quantity', rule: 'Cap. 406 Sch. 13 Part I' },
      { field: 'supply_date', rule: 'Cap. 406 Sch. 13 Part I – when it differs from the issue date' },
      { field: 'line_unit_price', rule: 'Cap. 406 Sch. 13 Part I' },
      { field: 'tax_rate_per_line', rule: 'Cap. 406 Sch. 13 Part I' },
      { field: 'tax_amount_per_rate', rule: 'Cap. 406 Sch. 13 Part I' },
      { field: 'tax_in_local_currency', rule: 'Cap. 406 Sch. 13; art. 230 Directive 2006/112/EC' },
    ],
    numbering: { gapless: true, multipleSeries: true },
    language: { note: 'English or Maltese.' },
    homeCurrencyTaxRequired: true,
    // Art. 48 Cap. 406: records kept for six years.
    retentionYears: 6,
    source: VAT_ACT,
  },
  // No domestic e-invoicing mandate; B2G Peppol is accepted but not mandatory.
  einvoicing: [],
  payments: {
    iban: true,
    qr: ['epc'],
    reference: 'free_text',
    localMethods: ['sepa', 'card'],
  },
  registry: {
    name: 'Malta Business Registry',
    url: 'https://mbr.mt/',
  },
  holidays: maltaHolidays,
  deadlines: maltaDeadlines,
  supportLevel: 'pack',
  verifiedAt: '2026-10-21',
  caveats: [
    'Rate history: only the current set is recorded; the date the 12 % rate started (taken as 2019-01-01) is not confirmed.',
    'Simplified invoices: the Thirteenth Schedule allows them, but the threshold could not be confirmed – no simplifiedThreshold is set.',
    'Article 11 invoice wording is not prescribed by the law as far as found; the note text needs a Maltese accountant.',
    'VAT return due dates: secondary sources give the 15th of the second month after the quarter (one gives the 22nd); tax periods are set per registrant and often staggered, so the calendar fits calendar-quarter filers only.',
    'Article 11 threshold: EUR 35,000 per MTCA 2025 notes; related persons\' turnover now counts. Article 11 registrants must also register under Article 12 for intra-EU acquisitions and reverse-charge services.',
    'Malta has no domestic B2B e-invoicing mandate as of the verification date; watch ViDA (2030) and any MTCA announcement.',
    'The VAT number check (weights 3, 4, 6, 7, 8, 9, 10, 1 mod 37) comes from python-stdnum / VIES practice, not an MTCA publication.',
    'Retail sales use fiscal receipts (Twelfth Schedule) – not modelled here.',
  ],
  sources: [VAT_ACT, MTCA_VAT, MTCA_SME, HOLIDAYS],
};
