import type { CountryPack, CountryTaxDeadline } from '../types.js';
import { isValidAfm, normalizeAfm } from './afm.js';
import { grHolidays, grLastWorkingDay } from './holidays.js';

const VAT_CODE = { title: 'Κώδικας ΦΠΑ (ν. 2859/2000, κωδικοποίηση ν. 5144/2024)', url: 'https://www.aade.gr/epiheiriseis/forologikes-ypohreoseis/fpa' };
const ELP = { title: 'ν. 4308/2014 – Ελληνικά Λογιστικά Πρότυπα (άρθρα 8–15Α)', url: 'https://www.aade.gr/sites/default/files/2018-04/n4308_2014.pdf' };
const SMALL_BUSINESS = {
  title: 'AADE – VAT scheme for small businesses (article 39 VAT Code, ν. 5222/2025)',
  url: 'https://aade.gr/en/international-issues/vat-scheme-small-businesses-article-39-vat-code-law-28592000',
};
const MYDATA = { title: 'AADE – myDATA', url: 'https://www.aade.gr/mydata' };
const B2B_PHASE2 = {
  title: 'Fiscal Requirements – Greece postpones second e-invoicing wave to November 2026 (A.1197/2026)',
  url: 'https://www.fiscal-requirements.com/news/6060-greece-postpones-second-e-invoicing-wave-to-november-2026',
};
const B2B_EINVOICING = { title: 'AADE – Ηλεκτρονική τιμολόγηση (A.1128/2025)', url: 'https://www.aade.gr/egrafes-polites/ilektroniki-timologisi' };
const B2G = { title: 'ν. 4601/2019 – ηλεκτρονική τιμολόγηση στις δημόσιες συμβάσεις', url: 'https://www.e-invoicing.gr/' };

/** The periodic VAT return (Φ2) is due on the last working day of the month after the period (Κώδικας ΦΠΑ art. 38). */
function grDeadlines(year: number): CountryTaxDeadline[] {
  return Array.from({ length: 12 }, (_, i) => ({
    date: grLastWorkingDay(year, i + 1),
    kind: 'vat_return',
    title: { el: 'Περιοδική δήλωση ΦΠΑ (Φ2) και καταβολή', en: 'Periodic VAT return (F2) and payment' },
    appliesTo: i % 3 === 0 ? 'double-entry books (monthly), and single-entry books for the quarter just ended' : 'double-entry books (monthly)',
  }));
}

export const GR: CountryPack = {
  code: 'GR',
  name: 'Greece',
  region: 'eu',
  euMember: true,
  currency: 'EUR',
  currencyMinorUnits: 2,
  timeZone: 'Europe/Athens',
  locales: ['el', 'en'],
  taxIds: [
    {
      kind: 'vat',
      label: { el: 'ΑΦΜ ΦΠΑ (EL)', en: 'VAT ID' },
      example: 'EL094019245',
      normalize: (v) => `EL${normalizeAfm(v)}`,
      validate: (v) => /^EL\d{9}$/.test(v.replace(/\s/g, '').toUpperCase()) && isValidAfm(v),
      requiredOnInvoice: false,
      source: VAT_CODE,
    },
    {
      kind: 'tax',
      label: { el: 'ΑΦΜ', en: 'Tax ID (AFM)' },
      example: '094019245',
      normalize: normalizeAfm,
      validate: isValidAfm,
      // ν. 4308/2014 art. 9: the issuer's and the business customer's ΑΦΜ are on every invoice.
      requiredOnInvoice: true,
      source: ELP,
    },
  ],
  indirectTax: {
    kind: 'vat',
    name: { el: 'ΦΠΑ', en: 'VAT' },
    // Κώδικας ΦΠΑ art. 21: 23/13/6 from 2015-07-20 (ν. 4334/2015), standard 24 % from 2016-06-01 (ν. 4389/2016).
    rateSets: [
      {
        validFrom: '2015-07-20',
        rates: [
          { rate: 23, kind: 'standard' },
          { rate: 13, kind: 'reduced', appliesTo: 'food, water, energy, catering, accommodation' },
          { rate: 6, kind: 'super_reduced', appliesTo: 'medicines, books, newspapers, theatre tickets' },
        ],
      },
      {
        validFrom: '2016-06-01',
        rates: [
          { rate: 24, kind: 'standard' },
          { rate: 13, kind: 'reduced', appliesTo: 'food, water, energy, catering, accommodation' },
          { rate: 6, kind: 'super_reduced', appliesTo: 'medicines, books, newspapers, theatre tickets' },
        ],
      },
    ],
    smallBusiness: {
      // Κώδικας ΦΠΑ art. 39 as replaced by ν. 5222/2025, applied from 2025-01-01: EUR 10,000 domestic turnover.
      threshold: 10000,
      currency: 'EUR',
      invoiceNote: {
        el: 'Απαλλαγή από ΦΠΑ βάσει του άρθρου 39 του Κώδικα ΦΠΑ (ν. 2859/2000).',
        en: 'Exempt from VAT under Article 39 of the Greek VAT Code.',
      },
      source: SMALL_BUSINESS,
    },
    reverseChargeNote: {
      crossBorder: {
        el: 'Αντίστροφη επιβάρυνση – άρθρο 196 Οδηγίας 2006/112/ΕΚ.',
        en: 'Reverse charge – Article 196 of Directive 2006/112/EC.',
      },
    },
    source: VAT_CODE,
  },
  invoice: {
    // ν. 4308/2014 art. 9 (invoice content) and art. 13 (simplified invoice).
    requirements: [
      { field: 'issue_date', rule: 'art. 9(1)(a) ν. 4308/2014' },
      { field: 'invoice_number', rule: 'art. 9(1)(b) ν. 4308/2014' },
      { field: 'supplier_tax_id', rule: 'art. 9(1)(c) ν. 4308/2014 (ΑΦΜ)' },
      { field: 'customer_vat_id', when: 'b2b', rule: 'art. 9(1)(d) ν. 4308/2014 (ΑΦΜ / VAT ID of the customer)' },
      { field: 'supplier_name', rule: 'art. 9(1)(e) ν. 4308/2014' },
      { field: 'supplier_address', rule: 'art. 9(1)(e) ν. 4308/2014' },
      { field: 'customer_name', rule: 'art. 9(1)(e) ν. 4308/2014' },
      { field: 'customer_address', rule: 'art. 9(1)(e) ν. 4308/2014' },
      { field: 'line_description', rule: 'art. 9(1)(f) ν. 4308/2014' },
      { field: 'line_quantity', rule: 'art. 9(1)(f) ν. 4308/2014' },
      { field: 'supply_date', rule: 'art. 9(1)(g) ν. 4308/2014' },
      { field: 'line_unit_price', rule: 'art. 9(1)(h) ν. 4308/2014' },
      { field: 'tax_rate_per_line', rule: 'art. 9(1)(i) ν. 4308/2014' },
      { field: 'tax_amount_per_rate', rule: 'art. 9(1)(j) ν. 4308/2014' },
      { field: 'tax_in_local_currency', rule: 'art. 9 ν. 4308/2014 (ΦΠΑ σε ευρώ)' },
      { field: 'document_title', rule: 'art. 8 ν. 4308/2014 (Τιμολόγιο / Απόδειξη, myDATA document type)' },
    ],
    title: { standard: { el: 'Τιμολόγιο', en: 'Invoice' }, simplified: { el: 'Απλοποιημένο τιμολόγιο', en: 'Simplified invoice' } },
    // Numbering per series (one per branch / document type), each series registered in myDATA through the issuing software.
    numbering: { gapless: true, multipleSeries: true },
    language: { note: 'Greek or another language; the authority may ask for a Greek translation (ν. 4308/2014 art. 8).' },
    homeCurrencyTaxRequired: true,
    // ν. 4308/2014 art. 10 with ν. 4987/2022 (ΚΦΔ) art. 17: records kept 5 years after the year, longer while an audit is open.
    retentionYears: 5,
    source: ELP,
  },
  einvoicing: [
    {
      scope: 'b2g',
      model: 'peppol_exchange',
      from: 'in_force',
      appliesTo: 'suppliers to public bodies (since 2020)',
      formats: ['peppol_bis', 'en16931'],
      platform: 'Κεντρικός Διαύλος / Peppol',
      source: B2G,
    },
    {
      scope: 'b2b',
      model: 'real_time_reporting',
      from: 'in_force',
      appliesTo: 'every business: invoice data reported to myDATA, which returns the MARK number printed on the invoice',
      formats: ['mydata_xml'],
      platform: 'myDATA (AADE)',
      source: MYDATA,
    },
    {
      scope: 'b2b',
      model: 'clearance',
      from: '2026-03-02',
      appliesTo: 'businesses with gross revenue above EUR 1,000,000 in FY2023 (transition to 2026-05-03)',
      formats: ['en16931', 'peppol_bis', 'mydata_xml'],
      platform: 'certified e-invoicing providers (Πάροχοι ΗΤ), timologio app, myDATA',
      source: B2B_EINVOICING,
    },
    {
      scope: 'b2b',
      model: 'clearance',
      from: '2026-11-02',
      appliesTo: 'all other businesses (gradual period to 2027-01-31)',
      formats: ['en16931', 'peppol_bis', 'mydata_xml'],
      platform: 'certified e-invoicing providers (Πάροχοι ΗΤ), timologio app, myDATA',
      source: B2B_PHASE2,
    },
  ],
  payments: {
    iban: true,
    reference: 'free_text',
    localMethods: ['sepa', 'iris', 'dias'],
  },
  registry: {
    name: 'ΓΕΜΗ – General Commercial Registry',
    url: 'https://www.businessportal.gr/',
    api: { url: 'https://opendata.businessportal.gr/', auth: 'api_key', notes: 'GEMI open-data API, key after registration.' },
  },
  holidays: grHolidays,
  deadlines: grDeadlines,
  supportLevel: 'pack',
  verifiedAt: '2026-10-28',
  caveats: [
    'Blocker: every Greek invoice must be reported to myDATA and carry its MARK and QR code; from 2026 B2B invoices must be issued through a certified provider (or AADE timologio). Billanta can only produce drafts for GR until it integrates a provider.',
    'Phase 2 date 2026-11-02 (A.1197/2026) comes from secondary reports; other sources say 2026-10-01 or 2026-10-12. Confirm on aade.gr.',
    'Five Aegean islands (Leros, Lesvos, Kos, Samos, Chios) have rates 30 % lower (17/9/4); not modelled, needs a subdivision rate set.',
    'Article 39 small-business exemption: EUR 10,000 confirmed by AADE; the invoice note wording is common practice, not prescribed.',
    'Paragraph letters in invoice.requirements (ν. 4308/2014 art. 9) were not re-read against the 2026 text; simplified-invoice threshold not set.',
    'POS terminals must be linked to cash registers (ΦΗΜ) and payments to myDATA; outside Billanta scope.',
    'Labour Day (1 May) is moved when it falls in Holy Week; the holiday list keeps it on 1 May.',
    'Retention: 5 years is the base rule; it extends while the audit period is open. Confirm with a Greek accountant.',
  ],
  sources: [VAT_CODE, ELP, SMALL_BUSINESS, MYDATA, B2B_EINVOICING, B2B_PHASE2, B2G],
};
