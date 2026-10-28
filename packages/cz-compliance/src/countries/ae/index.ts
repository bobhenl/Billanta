import type { CountryPack, CountryTaxDeadline, Source } from '../types.js';
import { HIJRI_ESTIMATES, dayRange, holidayList, pad2 } from './hijri.js';
import { isValidTrn, normalizeTrn } from './trn.js';

const VAT_LAW: Source = {
  title: 'Federal Decree-Law No. 8 of 2017 on VAT and its Executive Regulation (Cabinet Decision No. 52 of 2017)',
  url: 'https://tax.gov.ae/en/legislation.aspx',
};
const EINVOICING: Source = {
  title: 'Ministerial Decisions No. 243 and 244 of 2025 on the e-invoicing system (KPMG summary)',
  url: 'https://kpmg.com/ae/en/insights/tax-insights/implementation-of-the-electronic-invoicing-system-in-the-uae.html',
};
const PEPPOL_AE = 'Peppol (DCTCE five-corner model via accredited service providers)';

/** UAE official holidays; the Islamic ones are estimates, see hijri.ts. */
function holidays(year: number): string[] {
  const dates = [`${year}-01-01`, `${year}-12-02`, `${year}-12-03`];
  const h = HIJRI_ESTIMATES[year];
  if (h) {
    dates.push(...dayRange(h.eidAlFitr, 3), h.arafat, ...dayRange(h.eidAlAdha, 3), h.hijriNewYear, h.mawlid);
  }
  return holidayList(year, dates);
}

/**
 * VAT return and payment are due by the 28th day after the end of the tax
 * period (VAT Executive Regulation, tax returns; FTA VAT returns user guide). Listed for
 * monthly filers; quarterly filers use the months that follow their
 * FTA-assigned stagger.
 */
function deadlines(year: number): CountryTaxDeadline[] {
  const out: CountryTaxDeadline[] = [];
  for (let m = 1; m <= 12; m++) {
    out.push({
      date: `${year}-${pad2(m)}-28`,
      kind: 'vat_return',
      title: { en: 'VAT return and payment', ar: 'تقديم الإقرار وسداد ضريبة القيمة المضافة' },
      appliesTo: 'monthly VAT filers (quarterly filers: the month after their stagger quarter)',
    });
  }
  // 9 months after the end of the tax period (Federal Decree-Law No. 47 of 2022, art. 53).
  out.push({
    date: `${year}-09-30`,
    kind: 'corporate_tax_return',
    title: { en: 'Corporate tax return', ar: 'إقرار ضريبة الشركات' },
    appliesTo: 'taxable persons with a calendar financial year',
  });
  return out;
}

export const AE: CountryPack = {
  code: 'AE',
  name: 'United Arab Emirates',
  region: 'mena',
  euMember: false,
  currency: 'AED',
  currencyMinorUnits: 2,
  timeZone: 'Asia/Dubai',
  locales: ['ar', 'en'],
  subdivisions: [
    { code: 'AE-AZ', name: 'Abu Dhabi' },
    { code: 'AE-DU', name: 'Dubai' },
    { code: 'AE-SH', name: 'Sharjah' },
    { code: 'AE-AJ', name: 'Ajman' },
    { code: 'AE-UQ', name: 'Umm Al Quwain' },
    { code: 'AE-RK', name: 'Ras Al Khaimah' },
    { code: 'AE-FU', name: 'Fujairah' },
  ],
  taxIds: [
    {
      kind: 'vat',
      label: { en: 'TRN', ar: 'رقم التسجيل الضريبي' },
      example: '100123456700003',
      normalize: normalizeTrn,
      validate: isValidTrn,
      requiredOnInvoice: true,
      source: VAT_LAW,
    },
  ],
  indirectTax: {
    kind: 'vat',
    name: { en: 'VAT', ar: 'ضريبة القيمة المضافة' },
    rateSets: [
      {
        validFrom: '2018-01-01',
        rates: [
          { rate: 5, kind: 'standard' },
          {
            rate: 0,
            kind: 'zero',
            appliesTo:
              'exports, international transport, qualifying education and healthcare, first supply of new residential buildings, investment precious metals',
          },
        ],
      },
    ],
    // Mandatory above AED 375,000 of taxable supplies in 12 months, voluntary from AED 187,500 (Decree-Law art. 13, 17).
    registrationThreshold: { amount: 375_000, currency: 'AED' },
    reverseChargeNote: {
      crossBorder: {
        en: 'VAT payable by the recipient under the reverse charge mechanism (Art. 48 of Federal Decree-Law No. 8 of 2017).',
        ar: 'الضريبة مستحقة على المتلقي وفق آلية الاحتساب العكسي (المادة 48 من المرسوم بقانون اتحادي رقم 8 لسنة 2017).',
      },
      domestic: {
        en: 'Domestic reverse charge: the recipient accounts for the VAT (Cabinet Decisions on gold, diamonds, electronic devices and hydrocarbons).',
        ar: 'احتساب عكسي محلي: يحتسب المتلقي الضريبة (قرارات مجلس الوزراء بشأن الذهب والألماس والأجهزة الإلكترونية والمحروقات).',
      },
    },
    source: VAT_LAW,
  },
  invoice: {
    title: {
      standard: { en: 'Tax Invoice', ar: 'فاتورة ضريبية' },
      simplified: { en: 'Simplified Tax Invoice', ar: 'فاتورة ضريبية مبسطة' },
    },
    // Exec. Reg. art. 59(1) for a full tax invoice; art. 59(2) and (6) for the simplified one.
    requirements: [
      { field: 'document_title', rule: 'Exec. Reg. art. 59(1)' },
      { field: 'supplier_name', rule: 'Exec. Reg. art. 59(1)' },
      { field: 'supplier_address', rule: 'Exec. Reg. art. 59(1)' },
      { field: 'supplier_vat_id', rule: 'Exec. Reg. art. 59(1)' },
      { field: 'customer_name', when: 'above_simplified_threshold', rule: 'Exec. Reg. art. 59(1)' },
      { field: 'customer_address', when: 'above_simplified_threshold', rule: 'Exec. Reg. art. 59(1)' },
      { field: 'customer_vat_id', when: 'b2b', rule: 'Exec. Reg. art. 59(1)' },
      { field: 'invoice_number', rule: 'Exec. Reg. art. 59(1)' },
      { field: 'issue_date', rule: 'Exec. Reg. art. 59(1)' },
      { field: 'supply_date', rule: 'Exec. Reg. art. 59(1)' },
      { field: 'line_description', rule: 'Exec. Reg. art. 59(1)' },
      { field: 'line_quantity', rule: 'Exec. Reg. art. 59(1)' },
      { field: 'line_unit_price', rule: 'Exec. Reg. art. 59(1)' },
      { field: 'tax_rate_per_line', rule: 'Exec. Reg. art. 59(1)' },
      { field: 'tax_amount_per_rate', rule: 'Exec. Reg. art. 59(1)' },
      { field: 'total_with_tax', rule: 'Exec. Reg. art. 59(1)' },
      { field: 'tax_in_local_currency', rule: 'Exec. Reg. art. 59(1), art. 69' },
    ],
    // Simplified invoice when the recipient is not registered, or is registered and the consideration is up to AED 10,000 (art. 59(2)).
    simplifiedThreshold: { amount: 10_000, currency: 'AED' },
    numbering: { gapless: true, multipleSeries: true },
    language: {
      note: 'Arabic or English is accepted on invoices; the FTA may ask for an Arabic translation of records.',
    },
    homeCurrencyTaxRequired: true,
    retentionYears: 5,
    source: VAT_LAW,
  },
  einvoicing: [
    {
      scope: 'b2b',
      model: 'peppol_exchange',
      from: '2027-01-01',
      appliesTo: 'businesses with revenue of AED 50 million or more (appoint an accredited service provider by 2026-07-31)',
      formats: ['pint_ae'],
      platform: PEPPOL_AE,
      source: EINVOICING,
    },
    {
      scope: 'b2b',
      model: 'peppol_exchange',
      from: '2027-07-01',
      appliesTo: 'businesses with revenue below AED 50 million (appoint an accredited service provider by 2027-03-31)',
      formats: ['pint_ae'],
      platform: PEPPOL_AE,
      source: EINVOICING,
    },
    {
      scope: 'b2g',
      model: 'peppol_exchange',
      from: '2027-10-01',
      appliesTo: 'government entities (appoint an accredited service provider by 2027-03-31)',
      formats: ['pint_ae'],
      platform: PEPPOL_AE,
      source: EINVOICING,
    },
  ],
  payments: {
    iban: true,
    reference: 'free_text',
    localMethods: ['uaefts', 'aani', 'card'],
  },
  registry: {
    name: 'National Economic Register',
    url: 'https://ner.economy.ae',
  },
  holidays,
  deadlines,
  supportLevel: 'pack',
  verifiedAt: '2026-10-21',
  caveats: [
    'TRN: no published checksum, only the 15-digit shape is validated. Use the FTA TRN verification before relying on a number.',
    'No national company ID: trade licences are issued per emirate and per free zone in different formats, so no company ID validator is included.',
    'E-invoicing dates come from Ministerial Decision No. 244 of 2025 as summarised by KPMG, Deloitte and Sovos. The government-entity date (2027-10-01) was truncated in one source and must be checked on mof.gov.ae. A voluntary pilot runs from 2026-07-01. B2C is out of scope for now.',
    'E-invoicing: both sides must appoint an accredited service provider (ASP); the FTA reporting deadline and the final PINT AE field list must be checked against the MoF technical specification.',
    'Free zones and designated zones: supplies of goods within or between designated zones can be outside the scope of VAT (Decree-Law art. 50–51); services are not. The user must be able to mark such a supply instead of getting 5 % applied automatically.',
    'The simplified tax invoice (art. 59(6)) needs fewer fields than the full one; the contract has no separate simplified field list, so customer fields are marked "above_simplified_threshold".',
    'The Executive Regulation was amended by Cabinet Decision No. 100 of 2024 (in force 15 Nov 2024), touching electronic issuing and self-billing; field rules cite art. 59(1) of the 2017 text and need checking against the amended one.',
    'Corporate tax (9 % above AED 375,000 of taxable income, Federal Decree-Law No. 47 of 2022) is not an invoice matter; only its return deadline is listed.',
    'Islamic holidays are estimates (hijri.ts) and can move by a day; Eid al-Fitr gets a 4th day when Ramadan has 30 days, and the government sometimes moves holidays to a weekend. The working week is Monday–Friday (Friday a half day in the federal government), which the contract cannot express.',
    'Retention: 5 years under the Tax Procedures Law (15 years for real estate); later amendments changed some periods, so confirm with a UAE adviser.',
  ],
  sources: [
    VAT_LAW,
    EINVOICING,
    {
      title: 'Deloitte – Release of UAE e-invoicing legislation',
      url: 'https://www.deloitte.com/middle-east/en/services/tax/perspectives/release-of-uae-einvoicing-legislation.html',
    },
    {
      title: 'Sovos – UAE mandatory e-invoicing deadlines announced',
      url: 'https://sovos.com/regulatory-updates/vat/uae-mandatory-e-invoicing-deadlines-announced/',
    },
    { title: 'Ministry of Finance – e-invoicing', url: 'https://mof.gov.ae' },
    { title: 'Gulf News – UAE public holidays 2027', url: 'https://gulfnews.com/living-in-uae/ask-us/uae-public-holidays-2027-1.500638729' },
  ],
};
