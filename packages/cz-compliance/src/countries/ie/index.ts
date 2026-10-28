import type { CountryPack, Source, TaxRate } from '../types.js';
import { ieDeadlines, ieHolidays } from './calendar.js';
import { isValidCroNumber, isValidIeVatNumber, normalizeCroNumber, normalizeIeVatNumber } from './tax-ids.js';

export { ieDeadlines, ieHolidays } from './calendar.js';
export { isValidCroNumber, isValidIeVatNumber, normalizeCroNumber, normalizeIeVatNumber } from './tax-ids.js';

const VAT_RATES: Source = {
  title: 'Revenue – Current VAT rates',
  url: 'https://www.revenue.ie/en/vat/vat-rates/search-vat-rates/current-vat-rates.aspx',
};
const VAT_INVOICES: Source = {
  title: 'VAT Consolidation Act 2010, s. 66–67; Value-Added Tax Regulations 2010, reg. 20 (Revenue: VAT records and invoices)',
  url: 'https://www.revenue.ie/en/vat/vat-records-and-invoices/index.aspx',
};
const PHASE_ONE: Source = {
  title: 'Revenue – Phase One of VAT Modernisation: eInvoicing for large corporates (press release, 2026)',
  url: 'https://revenue.ie/en/corporate/press-office/press-releases/2026/pr-021026-phase-one-vat-modernisation.aspx',
};
const B2G: Source = {
  title: 'European Commission – eInvoicing in Ireland (S.I. 258/2019, Directive 2014/55/EU)',
  url: 'https://ec.europa.eu/digital-building-blocks/sites/display/DIGITAL/eInvoicing+in+Ireland',
};

const STANDARD: TaxRate = { rate: 23, kind: 'standard' };
const LIVESTOCK: TaxRate = { rate: 4.8, kind: 'super_reduced', appliesTo: 'livestock, greyhounds, horses for food production' };
const ZERO: TaxRate = { rate: 0, kind: 'zero', appliesTo: 'most food, children’s clothes and footwear, books, oral medicines, exports' };

/** Ireland. EU member; VAT under the VAT Consolidation Act 2010. */
export const IE: CountryPack = {
  code: 'IE',
  name: 'Ireland',
  region: 'eu',
  euMember: true,
  currency: 'EUR',
  currencyMinorUnits: 2,
  timeZone: 'Europe/Dublin',
  locales: ['en'],
  taxIds: [
    {
      kind: 'vat',
      label: { en: 'VAT number', ga: 'Uimhir CBL' },
      // Format example used in Revenue and EU VIES documentation; passes the mod 23 check.
      example: 'IE 6433435F',
      normalize: normalizeIeVatNumber,
      validate: isValidIeVatNumber,
      // Reg. 20(1)(c) VAT Regulations 2010: supplier's VAT registration number.
      requiredOnInvoice: true,
      source: VAT_INVOICES,
    },
    {
      kind: 'company',
      label: { en: 'CRO number', ga: 'Uimhir CRO' },
      example: '123456',
      normalize: normalizeCroNumber,
      validate: isValidCroNumber,
      // Companies Act 2014 s. 151 lists letters and order forms, not invoices.
      requiredOnInvoice: false,
      source: { title: 'Companies Registration Office', url: 'https://core.cro.ie/' },
    },
  ],
  indirectTax: {
    kind: 'vat',
    name: { en: 'VAT', ga: 'CBL' },
    rateSets: [
      {
        // Standard rate back to 23% from 1 March 2021 after the Covid cut to 21%.
        validFrom: '2021-03-01',
        rates: [
          STANDARD,
          { rate: 13.5, kind: 'reduced', appliesTo: 'fuel, building services, repairs, short-term accommodation' },
          { rate: 9, kind: 'reduced', appliesTo: 'newspapers, sporting facilities, restaurants, catering and hotels (temporary hospitality rate)' },
          LIVESTOCK,
          ZERO,
        ],
      },
      {
        // Temporary 9% hospitality rate ended 31 August 2023.
        validFrom: '2023-09-01',
        rates: [
          STANDARD,
          { rate: 13.5, kind: 'reduced', appliesTo: 'fuel, building services, repairs, accommodation, restaurants and catering' },
          { rate: 9, kind: 'reduced', appliesTo: 'newspapers and e-publications, sporting facilities, gas and electricity' },
          LIVESTOCK,
          ZERO,
        ],
      },
      {
        // Budget 2026 / Finance Act 2025: restaurant, catering, hot takeaway food and hairdressing to 9%.
        validFrom: '2026-07-01',
        rates: [
          STANDARD,
          { rate: 13.5, kind: 'reduced', appliesTo: 'fuel, building services, repairs, hotel and short-term accommodation' },
          {
            rate: 9,
            kind: 'reduced',
            appliesTo: 'restaurant and catering services, hot takeaway food, hairdressing, newspapers, sporting facilities, gas and electricity',
          },
          LIVESTOCK,
          ZERO,
        ],
      },
    ],
    // From 1 January 2025: EUR 42,500 for services, EUR 85,000 for goods
    // (VATCA 2010 s. 6, as amended by Finance Act 2024). Not registered = no VAT on the invoice.
    registrationThreshold: { amount: 42500, currency: 'EUR' },
    reverseChargeNote: {
      domestic: { en: 'VAT on this supply to be accounted for by the recipient (reverse charge, s. 16 VATCA 2010)' },
      crossBorder: { en: 'Reverse charge – VAT to be accounted for by the customer (Article 196, Directive 2006/112/EC)' },
    },
    source: VAT_RATES,
  },
  invoice: {
    // Reg. 20 VAT Regulations 2010 / s. 66 VATCA 2010. No prescribed title.
    requirements: [
      { field: 'issue_date', rule: 'Reg. 20(1)(a) VAT Regulations 2010' },
      { field: 'invoice_number', rule: 'Reg. 20(1)(b) – sequential number' },
      { field: 'supplier_name', rule: 'Reg. 20(1)(c)' },
      { field: 'supplier_address', rule: 'Reg. 20(1)(c)' },
      { field: 'supplier_vat_id', when: 'tax_registered', rule: 'Reg. 20(1)(c)' },
      { field: 'customer_name', rule: 'Reg. 20(1)(d)' },
      { field: 'customer_address', rule: 'Reg. 20(1)(d)' },
      { field: 'customer_vat_id', when: 'cross_border', rule: 'Reg. 20(1)(e) (intra-EU supplies and reverse charge)' },
      { field: 'supply_date', rule: 'Reg. 20(1)(f) – date of supply or payment on account' },
      { field: 'line_description', rule: 'Reg. 20(1)(g) – quantity and nature of goods, extent of services' },
      { field: 'line_quantity', rule: 'Reg. 20(1)(g)' },
      { field: 'line_unit_price', rule: 'Reg. 20(1)(h) – unit price excl. VAT, discounts' },
      { field: 'tax_rate_per_line', when: 'tax_registered', rule: 'Reg. 20(1)(i)' },
      { field: 'tax_amount_per_rate', when: 'tax_registered', rule: 'Reg. 20(1)(j)' },
      { field: 'total_with_tax', rule: 'Reg. 20(1)' },
      { field: 'tax_in_local_currency', when: 'tax_registered', rule: 'Art. 230 Directive 2006/112/EC – VAT in euro' },
    ],
    numbering: { gapless: true, multipleSeries: true },
    homeCurrencyTaxRequired: true,
    // s. 84 VATCA 2010: records kept 6 years.
    retentionYears: 6,
    source: VAT_INVOICES,
  },
  einvoicing: [
    {
      scope: 'b2g',
      model: 'post_audit',
      from: '2019-04-18',
      appliesTo: 'public bodies must accept EN 16931 e-invoices; suppliers are not obliged to send them',
      formats: ['peppol_bis', 'ubl', 'cii'],
      platform: 'Peppol',
      source: B2G,
    },
    {
      scope: 'b2b',
      model: 'real_time_reporting',
      from: '2028-11-01',
      appliesTo:
        'VAT-registered large corporates managed by Revenue’s Large Corporates Division, domestic B2B; every business must be able to receive e-invoices from this date',
      formats: ['ubl', 'cii'],
      source: PHASE_ONE,
    },
    {
      scope: 'b2b',
      model: 'real_time_reporting',
      from: '2029-11-01',
      appliesTo: 'Phase Two – extension to further VAT-registered businesses (scope still to be confirmed by Revenue)',
      formats: ['ubl', 'cii'],
      source: PHASE_ONE,
    },
  ],
  payments: {
    iban: true,
    qr: ['epc'],
    reference: 'free_text',
    localMethods: ['sepa', 'card'],
  },
  registry: {
    name: 'Companies Registration Office (CORE)',
    url: 'https://core.cro.ie/',
    api: {
      url: 'https://services.cro.ie/',
      auth: 'api_key',
      notes: 'Paid CRO Open Services API; VAT numbers are checked through EU VIES instead.',
    },
  },
  holidays: ieHolidays,
  deadlines: ieDeadlines,
  supportLevel: 'pack',
  verifiedAt: '2026-10-28',
  caveats: [
    'Registration threshold: EUR 42,500 for services and EUR 85,000 for goods (from 1 January 2025); the contract holds one amount, so the lower services figure is stored.',
    'Phase Two (November 2029) scope differs between sources: Revenue-adjacent advisers describe extension to intra-EU traders, others a general domestic roll-out. Phase Three (July 2030) follows ViDA. Formats and network (Peppol is likely) are not yet specified by Revenue.',
    'Invoices must be issued within 15 days of the end of the month of supply (s. 67 VATCA 2010) – the contract has no field for an issue deadline.',
    'Holidays are statutory public holidays; a holiday on a weekend is not moved, but banks and many employers close on the next working day. Good Friday is not a public holiday, though banks usually close.',
    'VAT deadlines assume bi-monthly ROS filers; monthly direct-debit and annual filers differ, and Revenue does not publish a weekend roll-forward rule.',
    'Income tax: the ROS pay-and-file extension (usually mid-November) changes every year and is not modelled.',
    'CRO numbers have no checksum; validation is format-only. The 4.8% livestock rate and the 9% gas/electricity rate (extended to 2030) are included without their exact end dates.',
    'Irish (ga) is an official language but invoices in English are fine; the app has no ga locale.',
  ],
  sources: [
    VAT_RATES,
    VAT_INVOICES,
    PHASE_ONE,
    B2G,
    {
      title: 'Citizens Information – Public holidays in Ireland',
      url: 'https://www.citizensinformation.ie/en/employment/employment-rights-and-conditions/leave-and-holidays/public-holidays/',
    },
    { title: 'Revenue – VAT returns and payment', url: 'https://www.revenue.ie/en/vat/returns-and-payment/index.aspx' },
  ],
};
