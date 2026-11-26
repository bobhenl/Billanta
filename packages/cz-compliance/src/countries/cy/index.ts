import type { CountryPack, CountryTaxDeadline } from '../types.js';
import { cyHolidays } from './holidays.js';
import { isValidTic, normalizeTic } from './tic.js';

const VAT_LAW = {
  title: 'Ο περί Φόρου Προστιθέμενης Αξίας Νόμος 95(I)/2000',
  url: 'https://www.mof.gov.cy/mof/tax/taxdep.nsf/page1b_en/page1b_en?opendocument',
};
const VAT_RATES = { title: 'Tax Department – VAT rates', url: 'https://www.mof.gov.cy/mof/tax/taxdep.nsf/page1b_en/page1b_en?opendocument' };
const REGISTRATION = { title: 'Tax Department – VAT registration', url: 'https://www.mof.gov.cy/mof/tax/taxdep.nsf/All/AC9AA4A98D8E1470C2257B7A00250D4F' };
const TAX_FOR_ALL = { title: 'Tax For All (TFA) portal', url: 'https://taxforall.mof.gov.cy/' };
const B2G = { title: 'Treasury of the Republic – e-invoicing in public procurement (Directive 2014/55/EU)', url: 'https://www.treasury.gov.cy/' };
const REGISTRY = { title: 'Department of Registrar of Companies and Intellectual Property', url: 'https://efiling.drcor.mcit.gov.cy/' };

/** Quarterly VAT return and payment: by the 10th of the second month after the quarter (VAT Law art. 23). */
function cyDeadlines(year: number): CountryTaxDeadline[] {
  const quarters: Array<[string, string]> = [
    ['02-10', 'Q4 of the previous year'],
    ['05-10', 'Q1'],
    ['08-10', 'Q2'],
    ['11-10', 'Q3'],
  ];
  return quarters.map(([md, period]) => ({
    date: `${year}-${md}`,
    kind: 'vat_return',
    title: { el: `Δήλωση ΦΠΑ και πληρωμή (${period})`, en: `VAT return and payment (${period})` },
    appliesTo: 'VAT-registered businesses on the standard quarterly period',
  }));
}

export const CY: CountryPack = {
  code: 'CY',
  name: 'Cyprus',
  region: 'eu',
  euMember: true,
  currency: 'EUR',
  currencyMinorUnits: 2,
  timeZone: 'Asia/Nicosia',
  locales: ['el', 'en'],
  taxIds: [
    {
      kind: 'vat',
      label: { el: 'Αριθμός Εγγραφής ΦΠΑ', en: 'VAT ID' },
      example: 'CY10259033P',
      normalize: (v) => `CY${normalizeTic(v)}`,
      validate: (v) => /^CY\d{8}[A-Z]$/.test(v.replace(/\s/g, '').toUpperCase()) && isValidTic(v),
      // VAT Law, Twelfth Schedule: the supplier's VAT number is on every tax invoice.
      requiredOnInvoice: true,
      source: VAT_LAW,
    },
    {
      kind: 'tax',
      label: { el: 'ΑΦΤ (Αριθμός Φορολογικής Ταυτότητας)', en: 'Tax Identification Code (TIC)' },
      example: '10259033P',
      normalize: normalizeTic,
      validate: isValidTic,
      requiredOnInvoice: false,
      source: TAX_FOR_ALL,
    },
  ],
  indirectTax: {
    kind: 'vat',
    name: { el: 'ΦΠΑ', en: 'VAT' },
    // Standard 19 % since 2014-01-13 (Law 165(I)/2013); 9 % and 5 % reduced, 0 % for listed supplies.
    rateSets: [
      {
        validFrom: '2014-01-13',
        rates: [
          { rate: 19, kind: 'standard' },
          { rate: 9, kind: 'reduced', appliesTo: 'accommodation, restaurant and catering services, passenger transport' },
          { rate: 5, kind: 'reduced', appliesTo: 'foodstuffs, medicines, books, newspapers, admission to cultural events' },
          { rate: 0, kind: 'zero', appliesTo: 'supplies listed in the Sixth Schedule' },
        ],
      },
    ],
    smallBusiness: {
      // Registration is compulsory once taxable turnover passes EUR 15,600 in 12 months (VAT Law art. 9, First Schedule).
      threshold: 15600,
      currency: 'EUR',
      invoiceNote: {
        el: 'Ο προμηθευτής δεν είναι εγγεγραμμένος στο Μητρώο ΦΠΑ.',
        en: 'The supplier is not registered for VAT in Cyprus.',
      },
      source: REGISTRATION,
    },
    reverseChargeNote: {
      crossBorder: {
        el: 'Αντίστροφη επιβάρυνση – άρθρο 196 Οδηγίας 2006/112/ΕΚ.',
        en: 'Reverse charge – Article 196 of Directive 2006/112/EC.',
      },
    },
    source: VAT_RATES,
  },
  invoice: {
    // VAT Law, Twelfth Schedule, Regulation 13 (contents of a tax invoice).
    requirements: [
      { field: 'invoice_number', rule: 'VAT Law, Twelfth Schedule (identifying number)' },
      { field: 'issue_date', rule: 'VAT Law, Twelfth Schedule (date of issue)' },
      { field: 'supply_date', rule: 'VAT Law, Twelfth Schedule (time of supply)' },
      { field: 'supplier_name', rule: 'VAT Law, Twelfth Schedule' },
      { field: 'supplier_address', rule: 'VAT Law, Twelfth Schedule' },
      { field: 'supplier_vat_id', rule: 'VAT Law, Twelfth Schedule (VAT registration number)' },
      { field: 'customer_name', rule: 'VAT Law, Twelfth Schedule' },
      { field: 'customer_address', rule: 'VAT Law, Twelfth Schedule' },
      { field: 'customer_vat_id', when: 'cross_border', rule: 'VAT Law, Twelfth Schedule (intra-EU supplies)' },
      { field: 'line_description', rule: 'VAT Law, Twelfth Schedule' },
      { field: 'line_quantity', rule: 'VAT Law, Twelfth Schedule' },
      { field: 'line_unit_price', rule: 'VAT Law, Twelfth Schedule' },
      { field: 'tax_rate_per_line', rule: 'VAT Law, Twelfth Schedule' },
      { field: 'tax_amount_per_rate', rule: 'VAT Law, Twelfth Schedule (total VAT in euro)' },
      { field: 'tax_in_local_currency', rule: 'VAT Law, Twelfth Schedule' },
    ],
    title: { standard: { el: 'Τιμολόγιο', en: 'Tax invoice' } },
    numbering: { gapless: true, multipleSeries: true },
    language: { note: 'Greek or English; no statutory language rule for B2B invoices.' },
    homeCurrencyTaxRequired: true,
    // VAT Law art. 46: records kept for 6 years.
    retentionYears: 6,
    source: VAT_LAW,
  },
  einvoicing: [
    {
      scope: 'b2g',
      model: 'peppol_exchange',
      from: 'in_force',
      appliesTo: 'suppliers to contracting authorities (receipt mandatory since 2019)',
      formats: ['peppol_bis', 'en16931'],
      platform: 'Peppol',
      source: B2G,
    },
  ],
  payments: {
    iban: true,
    reference: 'free_text',
    localMethods: ['sepa', 'jcc'],
  },
  registry: {
    name: 'Registrar of Companies (DRCOR)',
    url: REGISTRY.url,
  },
  holidays: cyHolidays,
  deadlines: cyDeadlines,
  supportLevel: 'pack',
  verifiedAt: '2026-10-28',
  caveats: [
    'No B2B e-invoicing or real-time reporting mandate announced; Cyprus is expected to follow ViDA (domestic e-invoicing optional from 2030). Re-check yearly.',
    'A 3 % rate was introduced for some supplies (e.g. certain social goods) in 2025 reforms per secondary sources; not confirmed on mof.gov.cy, so not modelled.',
    'The EUR 15,600 threshold is a registration threshold, not an EU SME exemption scheme; the invoice note for unregistered suppliers is not prescribed by law.',
    'Paragraph references in invoice.requirements point at the Twelfth Schedule as a whole; not re-read against the consolidated 2026 text.',
    'Quarterly deadlines are kept on the 10th even when it falls on a weekend; the Tax Department usually does not shift them. Some businesses have non-calendar quarters assigned at registration.',
    'Easter Tuesday is a public-sector and bank holiday, not a statutory day off for every employer; it is in the list because banks close.',
    'DRCOR has no public API; company lookup is manual through the e-filing portal.',
  ],
  sources: [VAT_LAW, VAT_RATES, REGISTRATION, TAX_FOR_ALL, B2G, REGISTRY],
};
