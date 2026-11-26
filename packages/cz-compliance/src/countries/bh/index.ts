import type { CountryPack, CountryTaxDeadline, Source } from '../types.js';
import { HIJRI_ESTIMATES, addDays, compact, dayRange, holidayList, lastDayOfMonth } from '../ae/hijri.js';

const VAT_LAW: Source = {
  title: 'National Bureau for Revenue – VAT (Decree-Law No. 48 of 2018 and its Executive Regulations)',
  url: 'https://www.nbr.gov.bh/vat',
};

/**
 * Bahrain VAT account number: 15 digits (NBR registration certificate).
 * No checksum is published.
 */
export const normalizeBhVat = (value: string): string => compact(value).replace(/^BH/, '');
export const isValidBhVat = (value: string): boolean => /^\d{15}$/.test(value);

/** Official holidays; the Islamic ones (incl. Ashura, 9–10 Muharram) are estimates, see ae/hijri.ts. */
function holidays(year: number): string[] {
  const dates = [`${year}-01-01`, `${year}-05-01`, `${year}-12-16`, `${year}-12-17`];
  const h = HIJRI_ESTIMATES[year];
  if (h) {
    dates.push(
      ...dayRange(h.eidAlFitr, 3),
      h.arafat,
      ...dayRange(h.eidAlAdha, 3),
      h.hijriNewYear,
      addDays(h.hijriNewYear, 8),
      addDays(h.hijriNewYear, 9),
      h.mawlid,
    );
  }
  return holidayList(year, dates);
}

/** VAT return and payment by the last day of the month after the period (NBR VAT General Guide). */
function deadlines(year: number): CountryTaxDeadline[] {
  const title = { en: 'VAT return and payment', ar: 'تقديم الإقرار وسداد ضريبة القيمة المضافة' };
  const out: CountryTaxDeadline[] = [];
  for (let m = 1; m <= 12; m++) {
    out.push({ date: lastDayOfMonth(year, m), kind: 'vat_return_monthly', title, appliesTo: 'monthly filers (supplies > BHD 3 million)' });
  }
  for (const m of [1, 4, 7, 10]) {
    out.push({ date: lastDayOfMonth(year, m), kind: 'vat_return_quarterly', title, appliesTo: 'quarterly filers' });
  }
  return out;
}

export const BH: CountryPack = {
  code: 'BH',
  name: 'Bahrain',
  region: 'mena',
  euMember: false,
  currency: 'BHD',
  // The dinar has 1,000 fils.
  currencyMinorUnits: 3,
  timeZone: 'Asia/Bahrain',
  locales: ['ar', 'en'],
  taxIds: [
    {
      kind: 'vat',
      label: { en: 'VAT account number', ar: 'رقم الحساب الضريبي' },
      example: '200012345600002',
      normalize: normalizeBhVat,
      validate: isValidBhVat,
      requiredOnInvoice: true,
      source: VAT_LAW,
    },
  ],
  indirectTax: {
    kind: 'vat',
    name: { en: 'VAT', ar: 'ضريبة القيمة المضافة' },
    rateSets: [
      {
        validFrom: '2019-01-01',
        rates: [
          { rate: 5, kind: 'standard' },
          { rate: 0, kind: 'zero', appliesTo: 'basic food items, exports, international transport, healthcare, education, new buildings' },
        ],
      },
      {
        // Decree-Law No. 33 of 2021 raised the standard rate to 10 %.
        validFrom: '2022-01-01',
        rates: [
          { rate: 10, kind: 'standard' },
          { rate: 0, kind: 'zero', appliesTo: 'basic food items, exports, international transport, healthcare, education, new buildings' },
        ],
      },
    ],
    // Mandatory above BHD 37,500 of annual supplies, voluntary from BHD 18,750.
    registrationThreshold: { amount: 37_500, currency: 'BHD' },
    reverseChargeNote: {
      crossBorder: {
        en: 'VAT to be accounted for by the recipient under the reverse charge mechanism.',
        ar: 'تحتسب الضريبة من قبل المتلقي وفق آلية الاحتساب العكسي.',
      },
    },
    source: VAT_LAW,
  },
  invoice: {
    title: {
      standard: { en: 'Tax Invoice', ar: 'فاتورة ضريبية' },
      simplified: { en: 'Simplified Tax Invoice', ar: 'فاتورة ضريبية مبسطة' },
    },
    // Executive Regulations, tax invoice contents (NBR VAT General Guide, section on tax invoices).
    requirements: [
      { field: 'document_title', rule: 'VAT Exec. Reg., tax invoice' },
      { field: 'invoice_number', rule: 'VAT Exec. Reg., tax invoice' },
      { field: 'issue_date', rule: 'VAT Exec. Reg., tax invoice' },
      { field: 'supply_date', rule: 'VAT Exec. Reg., tax invoice' },
      { field: 'supplier_name', rule: 'VAT Exec. Reg., tax invoice' },
      { field: 'supplier_address', rule: 'VAT Exec. Reg., tax invoice' },
      { field: 'supplier_vat_id', rule: 'VAT Exec. Reg., tax invoice' },
      { field: 'customer_name', when: 'above_simplified_threshold', rule: 'VAT Exec. Reg., tax invoice' },
      { field: 'customer_address', when: 'above_simplified_threshold', rule: 'VAT Exec. Reg., tax invoice' },
      { field: 'customer_vat_id', when: 'b2b', rule: 'VAT Exec. Reg., tax invoice' },
      { field: 'line_description', rule: 'VAT Exec. Reg., tax invoice' },
      { field: 'line_quantity', rule: 'VAT Exec. Reg., tax invoice' },
      { field: 'line_unit_price', rule: 'VAT Exec. Reg., tax invoice' },
      { field: 'tax_rate_per_line', rule: 'VAT Exec. Reg., tax invoice' },
      { field: 'tax_amount_per_rate', rule: 'VAT Exec. Reg., tax invoice' },
      { field: 'total_with_tax', rule: 'VAT Exec. Reg., tax invoice' },
      { field: 'tax_in_local_currency', rule: 'VAT Exec. Reg., tax invoice' },
    ],
    simplifiedThreshold: { amount: 500, currency: 'BHD' },
    numbering: { gapless: true, multipleSeries: true },
    language: { note: 'Arabic or English is accepted; the NBR may ask for an Arabic translation.' },
    homeCurrencyTaxRequired: true,
    retentionYears: 5,
    source: VAT_LAW,
  },
  einvoicing: [],
  payments: {
    iban: true,
    reference: 'free_text',
    localMethods: ['fawri', 'fawateer', 'benefitpay', 'card'],
  },
  registry: { name: 'Sijilat – Commercial Registration', url: 'https://www.sijilat.bh' },
  holidays,
  deadlines,
  supportLevel: 'pack',
  verifiedAt: '2026-10-28',
  caveats: [
    'E-invoicing: no mandate as of October 2026. The NBR ran tenders for a national B2B e-invoicing platform (2023, 2025) and a ZATCA-style clearance model is expected, but no law or date is published. Voluntary structured e-invoices are allowed.',
    'VAT account number: 15 digits by the NBR certificate; secondary sources only, no checksum published.',
    'Simplified tax invoice limit of BHD 500 and the BHD 3 million monthly-filing threshold come from secondary summaries of the Executive Regulations; confirm the articles with the NBR VAT General Guide.',
    'Invoice field rules cite the Executive Regulations generally, without article numbers.',
    'Retention: 5 years (15 for real estate) per the NBR guide; confirm with a Bahraini adviser.',
    'Holidays: Ashura (9–10 Muharram) and the Eids are estimates and can move by a day. Weekend is Friday–Saturday.',
    'The dinar uses 3 decimals: amounts, QR codes and rounding must not assume 2.',
  ],
  sources: [
    VAT_LAW,
    { title: 'ClearTax – e-invoicing in Bahrain 2026', url: 'https://www.cleartax.com/sa/e-invoicing-in-bahrain' },
    { title: 'Zoho Books – Bahrain VAT registration number', url: 'https://www.zoho.com/in/books/help/vat-bh/contacts.html' },
  ],
};
