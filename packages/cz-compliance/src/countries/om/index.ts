import type { CountryPack, CountryTaxDeadline, Source } from '../types.js';
import { HIJRI_ESTIMATES, addDays, compact, dayRange, holidayList, pad2 } from '../ae/hijri.js';

const VAT_LAW: Source = {
  title: 'Oman Tax Authority – VAT Law (Royal Decree No. 121/2020) and Executive Regulations (Decision No. 53/2021)',
  url: 'https://tms.taxoman.gov.om/portal/web/taxportal/vat-tax',
};
const FAWTARA: Source = {
  title: 'Oman Observer – phased e-invoicing from April 2027',
  url: 'https://www.omanobserver.om/ampArticle/1194559',
};

/** VATIN: "OM" followed by 10 digits. A bare 10-digit number gets the prefix. */
export const normalizeOmVat = (value: string): string => {
  const v = compact(value);
  return /^\d{10}$/.test(v) ? `OM${v}` : v;
};
export const isValidOmVat = (value: string): boolean => /^OM\d{10}$/.test(value);

/**
 * Royal Decree No. 88/2022 holidays. Eid al-Fitr runs from the last day of
 * Ramadan; Eid al-Adha from Arafat Day. Islamic dates are estimates, see
 * ae/hijri.ts.
 */
function holidays(year: number): string[] {
  const dates = [`${year}-01-11`, `${year}-11-20`, `${year}-11-21`];
  const h = HIJRI_ESTIMATES[year];
  if (h) {
    dates.push(
      h.israMiraj,
      ...dayRange(addDays(h.eidAlFitr, -1), 4),
      ...dayRange(h.arafat, 4),
      h.hijriNewYear,
      h.mawlid,
    );
  }
  return holidayList(year, dates);
}

/** VAT return and payment within 30 days after the end of the quarter (VAT Law art. 71). */
function deadlines(year: number): CountryTaxDeadline[] {
  return [1, 4, 7, 10].map((m) => ({
    date: `${year}-${pad2(m)}-30`,
    kind: 'vat_return',
    title: { en: 'VAT return and payment', ar: 'تقديم الإقرار وسداد ضريبة القيمة المضافة' },
    appliesTo: 'VAT-registered persons (quarterly periods)',
  }));
}

export const OM: CountryPack = {
  code: 'OM',
  name: 'Oman',
  region: 'mena',
  euMember: false,
  currency: 'OMR',
  // The rial has 1,000 baisa.
  currencyMinorUnits: 3,
  timeZone: 'Asia/Muscat',
  locales: ['ar', 'en'],
  taxIds: [
    {
      kind: 'vat',
      label: { en: 'VATIN', ar: 'رقم التعريف الضريبي لضريبة القيمة المضافة' },
      example: 'OM1100012345',
      normalize: normalizeOmVat,
      validate: isValidOmVat,
      requiredOnInvoice: true,
      source: VAT_LAW,
    },
  ],
  indirectTax: {
    kind: 'vat',
    name: { en: 'VAT', ar: 'ضريبة القيمة المضافة' },
    rateSets: [
      {
        validFrom: '2021-04-16',
        rates: [
          { rate: 5, kind: 'standard' },
          { rate: 0, kind: 'zero', appliesTo: 'basic food items, exports, international transport, medicines and medical equipment, investment gold' },
        ],
      },
    ],
    // Mandatory above OMR 38,500 of annual supplies, voluntary from OMR 19,250 (VAT Law art. 19, 20).
    registrationThreshold: { amount: 38_500, currency: 'OMR' },
    reverseChargeNote: {
      crossBorder: {
        en: 'Reverse charge: VAT is payable by the recipient.',
        ar: 'احتساب عكسي: الضريبة مستحقة على المتلقي.',
      },
    },
    source: VAT_LAW,
  },
  invoice: {
    title: { standard: { en: 'Tax Invoice', ar: 'فاتورة ضريبية' } },
    requirements: [
      { field: 'document_title', rule: 'Exec. Reg., tax invoice' },
      { field: 'invoice_number', rule: 'Exec. Reg., tax invoice' },
      { field: 'issue_date', rule: 'Exec. Reg., tax invoice' },
      { field: 'supply_date', rule: 'Exec. Reg., tax invoice' },
      { field: 'supplier_name', rule: 'Exec. Reg., tax invoice' },
      { field: 'supplier_address', rule: 'Exec. Reg., tax invoice' },
      { field: 'supplier_vat_id', rule: 'Exec. Reg., tax invoice' },
      { field: 'customer_name', rule: 'Exec. Reg., tax invoice' },
      { field: 'customer_address', rule: 'Exec. Reg., tax invoice' },
      { field: 'customer_vat_id', when: 'b2b', rule: 'Exec. Reg., tax invoice' },
      { field: 'line_description', rule: 'Exec. Reg., tax invoice' },
      { field: 'line_quantity', rule: 'Exec. Reg., tax invoice' },
      { field: 'line_unit_price', rule: 'Exec. Reg., tax invoice' },
      { field: 'tax_rate_per_line', rule: 'Exec. Reg., tax invoice' },
      { field: 'tax_amount_per_rate', rule: 'Exec. Reg., tax invoice' },
      { field: 'total_with_tax', rule: 'Exec. Reg., tax invoice' },
      { field: 'tax_in_local_currency', rule: 'Exec. Reg., tax invoice' },
    ],
    numbering: { gapless: true, multipleSeries: true },
    language: { required: ['ar'], note: 'Arabic is required; another language may appear next to it.' },
    homeCurrencyTaxRequired: true,
    retentionYears: 10,
    source: VAT_LAW,
  },
  einvoicing: [
    {
      scope: 'b2b',
      model: 'peppol_exchange',
      from: '2027-04-01',
      appliesTo: 'phased by taxpayer size (Tax Authority Decision No. 189/2026); a pilot with the largest taxpayers runs in the second half of 2026',
      formats: ['peppol_bis'],
      platform: 'Fawtara (Peppol five-corner model)',
      source: FAWTARA,
    },
  ],
  payments: {
    iban: true,
    reference: 'free_text',
    localMethods: ['achs', 'maal', 'card'],
  },
  registry: { name: 'Oman Business Platform', url: 'https://www.business.gov.om' },
  holidays,
  deadlines,
  supportLevel: 'pack',
  verifiedAt: '2026-10-28',
  caveats: [
    'Fawtara dates conflict: some advisers list phase 1 in August 2026 (about 100–150 largest taxpayers), phase 2 in February 2027 and phase 3 in August 2027; the latest sources (August 2026) say mandatory issuing starts in April 2027 after a pilot. Check the TMS portal for each tenant. The format (PINT OM vs Peppol BIS) is unconfirmed.',
    'Arabic language requirement and retention of 10 years come from secondary summaries of the Executive Regulations; confirm the articles.',
    'Simplified tax invoices: the rules for when one may be used are not confirmed, so none is modelled.',
    'Invoice field rules cite the Executive Regulations generally, without article numbers.',
    'VAT deadline cited as VAT Law art. 71 from secondary sources; confirm. If the 30th falls on a weekend or holiday the OTA practice for moving it is unconfirmed.',
    'Holidays: National Day was moved to 20–21 November and Accession Day (11 January) added by Royal Decree No. 88/2022; the Eids and Isra and Mi\'raj are estimates. Weekend is Friday–Saturday.',
    'The rial uses 3 decimals: amounts, QR codes and rounding must not assume 2.',
  ],
  sources: [
    VAT_LAW,
    FAWTARA,
    { title: 'ClearTax – Oman e-invoicing FAQs (Fawtara)', url: 'https://www.cleartax.com/om/e-invoicing-oman-faqs' },
    { title: 'Banqup – Oman Fawtara status guide', url: 'https://www.banqup.com/resources/blog/oman-fawtara-e-invoicing-status-guide' },
  ],
};
