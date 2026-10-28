import type { CountryPack, CountryTaxDeadline, Source } from '../types.js';
import { HIJRI_ESTIMATES, compact, dayRange, holidayList } from '../ae/hijri.js';

const GTA: Source = { title: 'General Tax Authority (Dhareeba)', url: 'https://www.gta.gov.qa' };
const EINVOICING_DRAFT: Source = {
  title: 'PwC – Qatar e-invoicing law and regulations approved (Council of Ministers, 6 May 2026)',
  url: 'https://www.pwc.com/m1/en/services/tax/middle-east-tax-news-alerts/2026/qatar-e-invoicing-law-and-regulations-approved.html',
};

/** Second Tuesday of February (National Sport Day, Emiri Decision No. 80 of 2011). */
function sportDay(year: number): string {
  const firstDow = new Date(Date.UTC(year, 1, 1)).getUTCDay();
  const firstTuesday = 1 + ((2 - firstDow + 7) % 7);
  return `${year}-02-${String(firstTuesday + 7).padStart(2, '0')}`;
}

/** Official holidays for the private sector; the Eids are estimates, see ae/hijri.ts. */
function holidays(year: number): string[] {
  const dates = [sportDay(year), `${year}-12-18`];
  const h = HIJRI_ESTIMATES[year];
  if (h) dates.push(...dayRange(h.eidAlFitr, 3), ...dayRange(h.eidAlAdha, 3));
  return holidayList(year, dates);
}

/** Income tax return: 4 months after the end of the tax year (Law No. 24 of 2018, art. 16). */
function deadlines(year: number): CountryTaxDeadline[] {
  return [
    {
      date: `${year}-04-30`,
      kind: 'income_tax_return',
      title: { en: 'Income tax return', ar: 'الإقرار الضريبي لضريبة الدخل' },
      appliesTo: 'taxpayers with a calendar tax year',
    },
  ];
}

export const QA: CountryPack = {
  code: 'QA',
  name: 'Qatar',
  region: 'mena',
  euMember: false,
  currency: 'QAR',
  currencyMinorUnits: 2,
  timeZone: 'Asia/Qatar',
  locales: ['ar', 'en'],
  taxIds: [
    {
      kind: 'tax',
      label: { en: 'TIN', ar: 'الرقم الضريبي' },
      example: '5000012345',
      normalize: compact,
      validate: (v) => /^\d{10}$/.test(v),
      requiredOnInvoice: false,
      source: GTA,
    },
  ],
  indirectTax: {
    kind: 'none',
    name: { en: 'VAT (not introduced)', ar: 'ضريبة القيمة المضافة (غير مطبقة)' },
    rateSets: [],
    source: GTA,
  },
  invoice: {
    // No tax invoice is prescribed while there is no VAT; these are the commercial basics.
    requirements: [
      { field: 'invoice_number' },
      { field: 'issue_date' },
      { field: 'supplier_name' },
      { field: 'supplier_address' },
      { field: 'customer_name' },
      { field: 'line_description' },
      { field: 'total_with_tax' },
    ],
    numbering: { gapless: true, multipleSeries: true },
    language: { note: 'Arabic or English; government customers and courts may require Arabic.' },
    homeCurrencyTaxRequired: false,
    retentionYears: 10,
    source: GTA,
  },
  einvoicing: [],
  payments: {
    iban: true,
    reference: 'free_text',
    localMethods: ['qpay', 'fawran', 'card'],
  },
  registry: { name: 'Ministry of Commerce and Industry – Commercial Registration', url: 'https://www.moci.gov.qa' },
  holidays,
  deadlines,
  supportLevel: 'pack',
  verifiedAt: '2026-10-28',
  caveats: [
    'No VAT: Qatar signed the GCC VAT agreement but has not enacted a VAT law. The Finance Minister has said VAT is coming, but there is no date. Expect 5 % with a QAR registration threshold like the other GCC states; revisit this pack when a law is published.',
    'E-invoicing: the Council of Ministers approved a draft e-invoicing law and implementing regulations on 6 May 2026, with a phased start expected from 1 January 2027 (large businesses first). It is not in force and the model (clearance vs reporting) is unconfirmed, so no mandate is listed. The contract has no way to record a planned mandate.',
    'TIN: the 10-digit shape comes from the Dhareeba portal practice and secondary sources; no checksum is published.',
    'Retention of 10 years follows the income tax law (Law No. 24 of 2018); confirm the article with a Qatari adviser.',
    'Holidays: Eid durations differ between the private sector (3 days by the Labour Law) and the government (often a week or more). Eid dates are estimates. The March bank holiday applies to banks only and is left out. Weekend is Friday–Saturday.',
    'Corporate income tax is 10 % for foreign-owned profits; Qatari- and GCC-owned shares are generally exempt. Not an invoice matter.',
  ],
  sources: [
    GTA,
    EINVOICING_DRAFT,
    { title: 'EY – Qatar approves draft e-invoicing law and implementing regulations', url: 'https://www.ey.com/en_gl/technical/tax-alerts/qatar-approves-draft-e-invoicing-law-and-implementing-regulations' },
    { title: 'Fiscal Requirements – Qatar VAT status', url: 'https://www.fiscal-requirements.com/news/5769-qatar-vat-status' },
  ],
};
