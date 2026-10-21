import type { CountryPack, CountryTaxDeadline, Source } from '../types.js';
import { HIJRI_ESTIMATES, dayRange, holidayList, lastDayOfMonth } from '../ae/hijri.js';
import { isValidCrn, isValidSaVat, normalizeCrn, normalizeSaVat } from './tax-ids.js';

const VAT_LAW: Source = {
  title: 'ZATCA – VAT Law and Implementing Regulations',
  url: 'https://zatca.gov.sa/en/RulesRegulations/Taxes/Pages/default.aspx',
};
const FATOORA: Source = {
  title: 'ZATCA – E-Invoicing (FATOORA)',
  url: 'https://zatca.gov.sa/en/E-Invoicing/Pages/default.aspx',
};
const WAVE_25: Source = {
  title: 'ZATCA wave 25 – threshold SAR 187,500, integration by 1 February 2027 (VATupdate)',
  url: 'https://www.vatupdate.com/2026/07/27/zatca-announces-wave-25-of-e-invoicing-threshold-halved-to-sar-187500-integration-deadline-1-february-2027/',
};

/**
 * Founding Day, National Day and the two Eids. The Labor Law (as amended in
 * 2024) gives four days for each Eid; the Eid al-Adha one starts on Arafat
 * Day. Islamic dates are estimates, see ae/hijri.ts.
 */
function holidays(year: number): string[] {
  const dates = [`${year}-02-22`, `${year}-09-23`];
  const h = HIJRI_ESTIMATES[year];
  if (h) dates.push(...dayRange(h.eidAlFitr, 4), ...dayRange(h.arafat, 4));
  return holidayList(year, dates);
}

/**
 * VAT return and payment by the last day of the month after the period
 * (VAT Implementing Regulations, tax returns). Monthly filing applies above
 * SAR 40 million of annual supplies, quarterly below.
 */
function deadlines(year: number): CountryTaxDeadline[] {
  const title = { en: 'VAT return and payment', ar: 'تقديم الإقرار وسداد ضريبة القيمة المضافة' };
  const out: CountryTaxDeadline[] = [];
  for (let m = 1; m <= 12; m++) {
    out.push({ date: lastDayOfMonth(year, m), kind: 'vat_return_monthly', title, appliesTo: 'monthly filers (supplies > SAR 40 million)' });
  }
  for (const m of [1, 4, 7, 10]) {
    out.push({ date: lastDayOfMonth(year, m), kind: 'vat_return_quarterly', title, appliesTo: 'quarterly filers' });
  }
  return out;
}

const SA_CHARGE_NOTE = {
  en: 'Reverse charge: VAT is accounted for by the recipient.',
  ar: 'احتساب عكسي: يحتسب المتلقي الضريبة.',
};

export const SA: CountryPack = {
  code: 'SA',
  name: 'Saudi Arabia',
  region: 'mena',
  euMember: false,
  currency: 'SAR',
  currencyMinorUnits: 2,
  timeZone: 'Asia/Riyadh',
  locales: ['ar', 'en'],
  taxIds: [
    {
      kind: 'vat',
      label: { en: 'VAT number', ar: 'الرقم الضريبي' },
      // The sample seller VAT number from ZATCA's e-invoicing SDK.
      example: '310122393500003',
      normalize: normalizeSaVat,
      validate: isValidSaVat,
      requiredOnInvoice: true,
      source: FATOORA,
    },
    {
      kind: 'company',
      label: { en: 'CR number', ar: 'رقم السجل التجاري' },
      example: '1010010000',
      normalize: normalizeCrn,
      validate: isValidCrn,
      requiredOnInvoice: true,
      source: FATOORA,
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
          { rate: 0, kind: 'zero', appliesTo: 'exports, international transport, qualifying medicines and medical equipment, investment metals' },
        ],
      },
      {
        // Royal Order of May 2020 raised the standard rate to 15 %.
        validFrom: '2020-07-01',
        rates: [
          { rate: 15, kind: 'standard' },
          { rate: 0, kind: 'zero', appliesTo: 'exports, international transport, qualifying medicines and medical equipment, investment metals' },
        ],
      },
    ],
    // Mandatory above SAR 375,000 of annual supplies, voluntary from SAR 187,500 (VAT Law and Implementing Regulations).
    registrationThreshold: { amount: 375_000, currency: 'SAR' },
    reverseChargeNote: { crossBorder: SA_CHARGE_NOTE },
    source: VAT_LAW,
  },
  invoice: {
    title: {
      standard: { en: 'Tax Invoice', ar: 'فاتورة ضريبية' },
      simplified: { en: 'Simplified Tax Invoice', ar: 'فاتورة ضريبية مبسطة' },
    },
    // Implementing Regulations art. 53 and the ZATCA e-invoicing data dictionary.
    requirements: [
      { field: 'document_title', rule: 'Impl. Reg. art. 53' },
      { field: 'invoice_number', rule: 'Impl. Reg. art. 53' },
      { field: 'issue_date', rule: 'Impl. Reg. art. 53' },
      { field: 'supply_date', rule: 'Impl. Reg. art. 53' },
      { field: 'supplier_name', rule: 'Impl. Reg. art. 53' },
      { field: 'supplier_address', rule: 'Impl. Reg. art. 53' },
      { field: 'supplier_vat_id', rule: 'Impl. Reg. art. 53' },
      { field: 'supplier_company_id', when: 'above_simplified_threshold', rule: 'ZATCA BR-KSA-08' },
      { field: 'customer_name', when: 'above_simplified_threshold', rule: 'Impl. Reg. art. 53' },
      { field: 'customer_address', when: 'above_simplified_threshold', rule: 'Impl. Reg. art. 53' },
      { field: 'customer_vat_id', when: 'b2b', rule: 'Impl. Reg. art. 53' },
      { field: 'line_description', rule: 'Impl. Reg. art. 53' },
      { field: 'line_quantity', rule: 'Impl. Reg. art. 53' },
      { field: 'line_unit_price', rule: 'Impl. Reg. art. 53' },
      { field: 'tax_rate_per_line', rule: 'Impl. Reg. art. 53' },
      { field: 'tax_amount_per_rate', rule: 'Impl. Reg. art. 53' },
      { field: 'total_with_tax', rule: 'Impl. Reg. art. 53' },
      { field: 'tax_in_local_currency', rule: 'Impl. Reg. art. 53' },
    ],
    // B2B supplies below SAR 1,000 may use a simplified invoice; B2C invoices are always simplified (Impl. Reg. art. 53).
    simplifiedThreshold: { amount: 1_000, currency: 'SAR' },
    numbering: { gapless: true, multipleSeries: true },
    language: {
      required: ['ar'],
      note: 'A tax invoice must be in Arabic; it may also carry another language next to it (Impl. Reg. art. 53).',
    },
    homeCurrencyTaxRequired: true,
    retentionYears: 6,
    source: VAT_LAW,
  },
  einvoicing: [
    {
      scope: 'b2b',
      model: 'post_audit',
      from: '2021-12-04',
      appliesTo: 'all VAT-registered persons (phase 1 "Generation": electronic issuing, no paper or plain PDF)',
      formats: ['zatca_ubl', 'pdf_a3'],
      platform: 'FATOORA',
      source: FATOORA,
    },
    {
      scope: 'b2c',
      model: 'post_audit',
      from: '2021-12-04',
      appliesTo: 'all VAT-registered persons (phase 1: simplified invoices carry the ZATCA QR code)',
      formats: ['zatca_ubl', 'pdf_a3'],
      platform: 'FATOORA',
      source: FATOORA,
    },
    {
      scope: 'b2b',
      model: 'clearance',
      from: '2023-01-01',
      appliesTo: 'phase 2 "Integration" in waves notified by ZATCA; wave 24 (VAT-subject revenue > SAR 375,000) by 2026-06-30',
      formats: ['zatca_ubl'],
      platform: 'FATOORA',
      source: FATOORA,
    },
    {
      scope: 'b2c',
      model: 'real_time_reporting',
      from: '2023-01-01',
      appliesTo: 'phase 2 waves: simplified invoices reported to FATOORA within 24 hours',
      formats: ['zatca_ubl'],
      platform: 'FATOORA',
      source: FATOORA,
    },
    {
      scope: 'b2b',
      model: 'clearance',
      from: '2027-02-01',
      appliesTo: 'wave 25: VAT-subject revenue > SAR 187,500 in any of 2022–2025 (B2C simplified invoices reported within 24 hours)',
      formats: ['zatca_ubl'],
      platform: 'FATOORA',
      source: WAVE_25,
    },
  ],
  payments: {
    iban: true,
    reference: 'free_text',
    localMethods: ['sarie', 'mada', 'sadad', 'stc_pay'],
  },
  registry: {
    name: 'Ministry of Commerce – Commercial Registration (Wathq)',
    url: 'https://wathq.sa',
    api: { url: 'https://developer.wathq.sa', auth: 'api_key', notes: 'Paid API by Wathq (Thiqah) for CR lookups.' },
  },
  holidays,
  deadlines,
  supportLevel: 'pack',
  verifiedAt: '2026-10-21',
  caveats: [
    'Invoices must be in Arabic. Billanta needs Arabic item descriptions and an RTL PDF before any SA tenant can issue invoices.',
    'Phase 2 (Integration) needs device onboarding (CSID), a cryptographic stamp, invoice hash chain (PIH), UUID, invoice counter and a TLV QR code on every invoice. The contract has no fields for the QR code, stamp or hash chain.',
    'Wave scopes come from ZATCA announcements as reported by advisers; ZATCA notifies each taxpayer at least 6 months ahead, which is the authoritative date for a given tenant.',
    'Simplified invoice: the SAR 1,000 B2B limit and "always simplified for B2C" both apply; the contract has only one threshold.',
    'Field rules cite Impl. Reg. art. 53 without paragraph letters; map each field to its paragraph against the current Arabic text.',
    'CRN: 10-digit shape only; the ZATCA seller ID can also be MOM, MLS, SAG, 700 number or another ID – the contract has no way to say "one of these".',
    'Islamic holidays are estimates (ae/hijri.ts) and can move by a day; the government often announces longer Eid breaks for the public sector. Weekend is Friday–Saturday.',
    'Zakat and income tax (20 % for foreign-owned shares) are separate from invoicing and not modelled.',
  ],
  sources: [VAT_LAW, FATOORA, WAVE_25, { title: 'KPMG – Saudi Arabia e-invoicing mandatory for revenue above SAR 187,500', url: 'https://kpmg.com/us/en/taxnewsflash/news/2026/07/saudi-arabia-e-invoicing-mandatory-for-taxpayers-with-revenue-above-sar-187500.html' }],
};
