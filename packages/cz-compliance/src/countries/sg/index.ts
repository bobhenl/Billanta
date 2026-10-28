import type { CountryPack, CountryTaxDeadline, Source } from '../types.js';
import { addDays, easter, sortedUnique, utc } from '../au/calendar.js';
import { isValidGstNo, isValidUen, normalizeGstNo, normalizeUen } from './ids.js';

const IRAS_INVOICING: Source = {
  title: 'IRAS – Invoicing, price display and record keeping',
  url: 'https://www.iras.gov.sg/taxes/goods-services-tax-(gst)/basics-of-gst/invoicing-price-display-and-record-keeping',
};
const IRAS_GST_RATE: Source = {
  title: 'IRAS – Current GST rates',
  url: 'https://www.iras.gov.sg/taxes/goods-services-tax-(gst)/basics-of-gst/current-gst-rates',
};
const IRAS_REGISTRATION: Source = {
  title: 'IRAS – Do I need to register for GST',
  url: 'https://www.iras.gov.sg/taxes/goods-services-tax-(gst)/gst-registration-deregistration/do-i-need-to-register-for-gst',
};
const IRAS_INVOICENOW: Source = {
  title: 'IRAS – GST InvoiceNow Requirement',
  url: 'https://www.iras.gov.sg/taxes/goods-services-tax-(gst)/gst-invoicenow-requirement',
};
const IMDA_INVOICENOW: Source = { title: 'IMDA – InvoiceNow', url: 'https://www.imda.gov.sg/how-we-can-help/nationwide-e-invoicing-framework' };
const IRAS_F5: Source = {
  title: 'IRAS – Filing GST (GST F5 due dates)',
  url: 'https://www.iras.gov.sg/taxes/goods-services-tax-(gst)/filing-gst/filing-gst-returns',
};
const MOM_HOLIDAYS: Source = { title: 'Ministry of Manpower – Public holidays', url: 'https://www.mom.gov.sg/employment-practices/public-holidays' };
const ACRA: Source = { title: 'ACRA – Bizfile', url: 'https://www.bizfile.gov.sg/' };
const PAYNOW: Source = { title: 'MAS – PayNow and SGQR', url: 'https://www.mas.gov.sg/development/e-payments' };

/**
 * Gazetted public holidays (Holidays Act 1998, Schedule, as published by MOM).
 * Chinese New Year, Hari Raya Puasa/Haji, Vesak Day and Deepavali follow lunar
 * or religious calendars and are gazetted a year ahead, so they come from this
 * table. A holiday on a Sunday gives the next Monday off (s 4); those Mondays
 * are included.
 */
const GAZETTED: Readonly<Record<number, readonly string[]>> = {
  2025: ['01-01', '01-29', '01-30', '03-31', '04-18', '05-01', '05-03', '05-12', '06-07', '08-09', '10-20', '12-25'],
  2026: ['01-01', '02-17', '02-18', '03-21', '04-03', '05-01', '05-27', '05-31', '06-01', '08-09', '08-10', '11-08', '11-09', '12-25'],
};

/**
 * Public holidays. For years without a gazetted table only the fixed-date
 * ones, Good Friday and their Sunday substitutes are returned (see caveats).
 */
export function sgHolidays(year: number): string[] {
  const table = GAZETTED[year];
  if (table) return table.map((md) => `${year}-${md}`);
  const fixed = [utc(year, 1, 1), utc(year, 5, 1), utc(year, 8, 9), utc(year, 12, 25), addDays(easter(year), -2)];
  return sortedUnique([...fixed, ...fixed.filter((d) => d.getUTCDay() === 0).map((d) => addDays(d, 1))]);
}

/**
 * GST F5 return and payment: one month after the end of the accounting
 * period (GST Act 1993 s 41 and GST (General) Regulations reg 59). For
 * calendar quarters that is 31 January, 30 April, 31 July and 31 October.
 */
export function sgDeadlines(year: number): CountryTaxDeadline[] {
  const quarters: ReadonlyArray<readonly [string, string]> = [
    ['01-31', 'October–December'],
    ['04-30', 'January–March'],
    ['07-31', 'April–June'],
    ['10-31', 'July–September'],
  ];
  return quarters.map(([md, q]) => ({
    date: `${year}-${md}`,
    kind: 'gst_f5',
    title: { en: `GST F5 return and payment (${q} quarter)` },
    appliesTo: 'GST-registered businesses with calendar-quarter accounting periods',
  }));
}

export const SG: CountryPack = {
  code: 'SG',
  name: 'Singapore',
  region: 'apac',
  euMember: false,
  currency: 'SGD',
  currencyMinorUnits: 2,
  timeZone: 'Asia/Singapore',
  locales: ['en-SG', 'en'],
  taxIds: [
    {
      kind: 'company',
      label: { en: 'UEN' },
      // ACRA's own sample from the UEN format description.
      example: '197401143C',
      normalize: normalizeUen,
      validate: isValidUen,
      requiredOnInvoice: false,
      source: ACRA,
    },
    {
      kind: 'vat',
      label: { en: 'GST Reg. No.' },
      // M-format sample in the shape IRAS shows on its invoice guide.
      example: 'M2-0012345-X',
      normalize: normalizeGstNo,
      validate: isValidGstNo,
      // GST (General) Regulations reg 11: the supplier's GST registration number on every tax invoice.
      requiredOnInvoice: true,
      source: IRAS_INVOICING,
    },
  ],
  indirectTax: {
    kind: 'gst',
    name: { en: 'GST' },
    // Goods and Services Tax Act 1993 s 16 and its amendments.
    rateSets: [
      { validFrom: '1994-04-01', rates: [{ rate: 3, kind: 'standard' }, { rate: 0, kind: 'zero', appliesTo: 'exports, international services' }] },
      { validFrom: '2003-01-01', rates: [{ rate: 4, kind: 'standard' }, { rate: 0, kind: 'zero', appliesTo: 'exports, international services' }] },
      { validFrom: '2004-01-01', rates: [{ rate: 5, kind: 'standard' }, { rate: 0, kind: 'zero', appliesTo: 'exports, international services' }] },
      { validFrom: '2007-07-01', rates: [{ rate: 7, kind: 'standard' }, { rate: 0, kind: 'zero', appliesTo: 'exports, international services' }] },
      { validFrom: '2023-01-01', rates: [{ rate: 8, kind: 'standard' }, { rate: 0, kind: 'zero', appliesTo: 'exports, international services' }] },
      { validFrom: '2024-01-01', rates: [{ rate: 9, kind: 'standard' }, { rate: 0, kind: 'zero', appliesTo: 'exports, international services' }] },
    ],
    // GST Act First Schedule: taxable turnover over SGD 1 million in a calendar year (or expected in the next 12 months).
    registrationThreshold: { amount: 1_000_000, currency: 'SGD' },
    reverseChargeNote: {
      crossBorder: { en: 'Imported services and low-value goods: a GST-registered recipient that is not entitled to full input tax accounts for GST under the reverse charge (GST Act s 14).' },
    },
    source: IRAS_REGISTRATION,
  },
  invoice: {
    // GST (General) Regulations reg 11 prescribes the words "tax invoice"; a simplified invoice (reg 12) has no set title.
    title: { standard: { en: 'Tax Invoice' } },
    requirements: [
      { field: 'document_title', when: 'tax_registered', rule: 'GST (General) Regulations reg 11 – the words "tax invoice"' },
      { field: 'invoice_number', rule: 'GST (General) Regulations reg 11, 12' },
      { field: 'issue_date', rule: 'GST (General) Regulations reg 11, 12' },
      { field: 'supplier_name', rule: 'GST (General) Regulations reg 11, 12' },
      { field: 'supplier_address', rule: 'GST (General) Regulations reg 11, 12' },
      { field: 'supplier_vat_id', when: 'tax_registered', rule: 'GST (General) Regulations reg 11, 12' },
      { field: 'line_description', rule: 'GST (General) Regulations reg 11, 12' },
      { field: 'total_with_tax', rule: 'GST (General) Regulations reg 11, 12' },
      { field: 'customer_name', when: 'above_simplified_threshold', rule: 'GST (General) Regulations reg 11' },
      { field: 'customer_address', when: 'above_simplified_threshold', rule: 'GST (General) Regulations reg 11' },
      { field: 'tax_rate_per_line', when: 'above_simplified_threshold', rule: 'GST (General) Regulations reg 11 – rate and amount of GST' },
      { field: 'tax_amount_per_rate', when: 'tax_registered', rule: 'Reg 11: GST amount; reg 12: a statement that the price includes GST' },
      { field: 'tax_in_local_currency', when: 'cross_border', rule: 'GST (General) Regulations reg 11(2) – GST shown in SGD' },
    ],
    // Reg 12: simplified tax invoice when the total including GST is at most SGD 1,000.
    simplifiedThreshold: { amount: 1_000, currency: 'SGD' },
    numbering: { gapless: false, multipleSeries: true },
    homeCurrencyTaxRequired: true,
    // GST Act s 46: five years.
    retentionYears: 5,
    source: IRAS_INVOICING,
  },
  einvoicing: [
    {
      scope: 'b2g',
      model: 'peppol_exchange',
      from: 'in_force',
      appliesTo: 'Suppliers to government agencies (Vendors@Gov) can send InvoiceNow e-invoices; agencies receive them',
      formats: ['peppol_pint_sg'],
      platform: 'InvoiceNow (Peppol)',
      source: IMDA_INVOICENOW,
    },
    {
      scope: 'b2b',
      model: 'peppol_exchange',
      from: '2025-11-01',
      appliesTo: 'Newly incorporated companies that register for GST voluntarily within 6 months of incorporation must send invoice data to IRAS via InvoiceNow',
      formats: ['peppol_pint_sg'],
      platform: 'InvoiceNow (Peppol)',
      source: IRAS_INVOICENOW,
    },
    {
      scope: 'b2b',
      model: 'peppol_exchange',
      from: '2026-04-01',
      appliesTo: 'All new voluntary GST registrants must send invoice data to IRAS via InvoiceNow',
      formats: ['peppol_pint_sg'],
      platform: 'InvoiceNow (Peppol)',
      source: IRAS_INVOICENOW,
    },
  ],
  payments: {
    iban: false,
    qr: ['paynow'],
    reference: 'free_text',
    localMethods: ['paynow', 'fast', 'giro', 'bank_transfer', 'card'],
  },
  registry: {
    name: 'ACRA Bizfile',
    url: 'https://www.bizfile.gov.sg/',
    api: {
      url: 'https://data.gov.sg/datasets?query=acra',
      auth: 'none',
      notes: 'data.gov.sg publishes the ACRA entity register (UEN, name, status, address) as open datasets; Bizfile itself has no free lookup API. GST status: IRAS "Check GST register" web search.',
    },
  },
  holidays: sgHolidays,
  deadlines: sgDeadlines,
  supportLevel: 'pack',
  verifiedAt: '2026-10-28',
  caveats: [
    'Holidays exist as a table for 2025 and 2026 only; other years return just New Year, Labour Day, National Day, Christmas, Good Friday and their Sunday substitutes. Lunar and religious holidays must be added each year from the MOM gazette. 2025 includes Polling Day (3 May).',
    'GST InvoiceNow: the contract has no "reporting via Peppol" model – the supplier sends a copy of its invoice data to IRAS through an Access Point by the GST return due date. Modelled as b2b peppol_exchange. Later phases for existing registrants (reported as 2028–2031) are not confirmed by IRAS and are not modelled.',
    'GST registration numbers in the M-format have no published check character; the validator checks the format only (a UEN-based GST number gets the UEN checksum).',
    'UEN check characters are reimplemented from the published scheme (no official IRAS/ACRA spec document); ROC years after the current year are rejected.',
    'GST F5 dates assume calendar quarters; businesses with other accounting periods or monthly filing have different dates. Whether a due date on a weekend moves is not modelled.',
    'A full tax invoice must be issued within 30 days of the time of supply; Billanta does not enforce this.',
    'No domestic account validator: Singapore bank account formats differ by bank (7–14 digits) with no shared checksum.',
    'The simplified invoice and the GST statement wording ("Price payable includes GST") are not exposed as a separate title.',
  ],
  sources: [IRAS_INVOICING, IRAS_GST_RATE, IRAS_REGISTRATION, IRAS_INVOICENOW, IMDA_INVOICENOW, IRAS_F5, MOM_HOLIDAYS, ACRA, PAYNOW],
};
