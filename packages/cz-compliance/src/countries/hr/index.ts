import type { CountryPack, CountryTaxDeadline } from '../types.js';
import { hrDeadlineOn, hrHolidays } from './holidays.js';
import { isValidOib, normalizeOib } from './oib.js';

const ZPDV = { title: 'Zakon o porezu na dodanu vrijednost (NN 73/13 i izmjene)', url: 'https://www.zakon.hr/z/1455/zakon-o-porezu-na-dodanu-vrijednost' };
const ZFISK = { title: 'Zakon o fiskalizaciji (NN 89/25)', url: 'https://narodne-novine.nn.hr/clanci/sluzbeni/2025_06_89_1233.html' };
const PU_ERACUN = {
  title: 'Porezna uprava – Izdavanje i primanje eRačuna i fiskalizacija eRačuna',
  url: 'https://porezna-uprava.gov.hr/hr/izdavanje-i-primanje-eracuna-i-fiskalizacija-eracuna/8047',
};
const PU_GUIDE = { title: 'Porezna uprava – Vodič kroz Fiskalizaciju 2.0', url: 'https://porezna-uprava.gov.hr/hr/Kategorija/8151' };
const THRESHOLD_2025 = { title: 'RRiF – Novi prag za ulazak / izlazak iz sustava PDV-a u 2025.', url: 'https://www.rrif.hr/clanak-23615/' };
const B2G = {
  title: 'Zakon o elektroničkom izdavanju računa u javnoj nabavi (NN 94/18)',
  url: 'https://narodne-novine.nn.hr/clanci/sluzbeni/2018_10_94_1820.html',
};

/** The PDV return and payment are due by the 20th of the month after the period (Zakon o PDV-u art. 85). */
function hrDeadlines(year: number): CountryTaxDeadline[] {
  return Array.from({ length: 12 }, (_, i) => ({
    date: hrDeadlineOn(year, i + 1, 20),
    kind: 'vat_return',
    title: { hr: 'Prijava PDV-a (obrazac PDV) i plaćanje PDV-a', en: 'VAT return (PDV form) and VAT payment' },
    appliesTo: i % 3 === 0 ? 'monthly filers, and quarterly filers for the quarter just ended' : 'monthly VAT filers',
  }));
}

export const HR: CountryPack = {
  code: 'HR',
  name: 'Croatia',
  region: 'eu',
  euMember: true,
  // The euro replaced the kuna on 2023-01-01.
  currency: 'EUR',
  currencyMinorUnits: 2,
  timeZone: 'Europe/Zagreb',
  locales: ['hr', 'en'],
  taxIds: [
    {
      kind: 'vat',
      label: { hr: 'PDV ID broj', en: 'VAT ID' },
      example: 'HR81793146560',
      normalize: (v) => `HR${normalizeOib(v)}`,
      validate: (v) => /^HR\d{11}$/.test(v.replace(/\s/g, '').toUpperCase()) && isValidOib(v),
      requiredOnInvoice: false,
      source: ZPDV,
    },
    {
      kind: 'tax',
      label: { hr: 'OIB', en: 'Personal identification number (OIB)' },
      example: '81793146560',
      normalize: normalizeOib,
      validate: isValidOib,
      // Zakon o PDV-u art. 79(1)(3): the supplier's OIB is on every invoice; PDV ID only on intra-EU supplies.
      requiredOnInvoice: true,
      source: { title: 'Porezna uprava – OIB', url: 'https://www.porezna-uprava.hr/HR_OIB/Stranice/default.aspx' },
    },
  ],
  indirectTax: {
    kind: 'vat',
    name: { hr: 'PDV', en: 'VAT' },
    // Zakon o PDV-u art. 38: 25 % since 2012-03-01, 13 % from 2014-01-01 next to 5 %.
    rateSets: [
      {
        validFrom: '2014-01-01',
        rates: [
          { rate: 25, kind: 'standard' },
          { rate: 13, kind: 'reduced', appliesTo: 'accommodation, catering, newspapers, water supply, some food' },
          { rate: 5, kind: 'super_reduced', appliesTo: 'bread, milk, books, medicines, medical devices, cinema tickets' },
        ],
      },
    ],
    smallBusiness: {
      // Zakon o PDV-u art. 90(1) as amended from 2025-01-01 (NN 152/24): EUR 60,000, was 40,000 in 2024.
      threshold: 60000,
      currency: 'EUR',
      invoiceNote: {
        hr: 'Porezni obveznik nije u sustavu PDV-a, PDV nije obračunat temeljem čl. 90. st. 1. Zakona o PDV-u.',
        en: 'Supplier not registered for VAT; VAT not charged under Article 90(1) of the Croatian VAT Act.',
      },
      source: THRESHOLD_2025,
    },
    reverseChargeNote: {
      // Zakon o PDV-u art. 75(3) (construction, scrap, ...) and art. 75(1)(2) / 17(1) for EU services.
      domestic: {
        hr: 'Prijenos porezne obveze – čl. 75. st. 3. Zakona o PDV-u.',
        en: 'Domestic reverse charge – Article 75(3) of the Croatian VAT Act.',
      },
      crossBorder: {
        hr: 'Prijenos porezne obveze – čl. 196. Direktive 2006/112/EZ.',
        en: 'Reverse charge – Article 196 of Directive 2006/112/EC.',
      },
    },
    source: ZPDV,
  },
  invoice: {
    // Zakon o PDV-u art. 79 lists the content.
    requirements: [
      { field: 'invoice_number', rule: 'art. 79(1)(1) Zakona o PDV-u' },
      { field: 'issue_date', rule: 'art. 79(1)(2) Zakona o PDV-u' },
      { field: 'supplier_tax_id', rule: 'art. 79(1)(3) Zakona o PDV-u (OIB)' },
      { field: 'customer_vat_id', when: 'cross_border', rule: 'art. 79(1)(4) Zakona o PDV-u' },
      { field: 'supplier_name', rule: 'art. 79(1)(5) Zakona o PDV-u' },
      { field: 'supplier_address', rule: 'art. 79(1)(5) Zakona o PDV-u' },
      { field: 'customer_name', rule: 'art. 79(1)(5) Zakona o PDV-u' },
      { field: 'customer_address', rule: 'art. 79(1)(5) Zakona o PDV-u' },
      { field: 'line_description', rule: 'art. 79(1)(6) Zakona o PDV-u' },
      { field: 'line_quantity', rule: 'art. 79(1)(6) Zakona o PDV-u' },
      { field: 'supply_date', rule: 'art. 79(1)(7) Zakona o PDV-u' },
      { field: 'line_unit_price', rule: 'art. 79(1)(8) Zakona o PDV-u' },
      { field: 'tax_rate_per_line', rule: 'art. 79(1)(9) Zakona o PDV-u' },
      { field: 'tax_amount_per_rate', rule: 'art. 79(1)(10) Zakona o PDV-u' },
      { field: 'tax_in_local_currency', rule: 'art. 79 Zakona o PDV-u (PDV iskazan u eurima)' },
    ],
    // Pravilnik o fiskalizaciji: number = sequence / business premises / device; premises are registered in ePorezna.
    numbering: { gapless: true, multipleSeries: true },
    language: { required: ['hr'], note: 'Invoices in Croatian; another language may be added next to it.' },
    homeCurrencyTaxRequired: true,
    // Zakon o PDV-u art. 79(9) read with Opći porezni zakon: invoices kept for 11 years.
    retentionYears: 11,
    source: ZPDV,
  },
  einvoicing: [
    {
      scope: 'b2g',
      model: 'post_audit',
      from: 'in_force',
      appliesTo: 'all suppliers to public contracting authorities (since 2019-07-01)',
      formats: ['ubl', 'cii', 'en16931_hr_cius'],
      platform: 'Servis eRačun za državu (FINA)',
      source: B2G,
    },
    {
      scope: 'b2b',
      model: 'real_time_reporting',
      from: '2026-01-01',
      appliesTo: 'VAT-registered issuers and all recipients; the issuer and the recipient fiscalize the eRačun data with Porezna uprava',
      formats: ['en16931_hr_cius', 'ubl', 'cii'],
      platform: 'Fiskalizacija 2.0 via information intermediaries (posrednici) or MIKROeRAČUN',
      source: PU_ERACUN,
    },
    {
      scope: 'b2b',
      model: 'real_time_reporting',
      from: '2027-01-01',
      appliesTo: 'issuers outside the VAT system (they only receive eRačuni during 2026)',
      formats: ['en16931_hr_cius', 'ubl', 'cii'],
      platform: 'Fiskalizacija 2.0 / MIKROeRAČUN',
      source: PU_GUIDE,
    },
    {
      scope: 'b2c',
      model: 'real_time_reporting',
      from: '2026-01-01',
      appliesTo: 'every receipt to consumers, whatever the payment method (cash only before 2026)',
      formats: ['fiskalizacija_xml'],
      platform: 'Porezna uprava CIS (JIR / ZKI codes)',
      source: ZFISK,
    },
  ],
  payments: {
    iban: true,
    qr: ['hub3', 'epc'],
    reference: 'free_text',
    localMethods: ['sepa', 'hub3'],
  },
  registry: {
    name: 'Sudski registar (court register)',
    url: 'https://sudreg.pravosudje.hr/',
    api: {
      url: 'https://sudreg-data.gov.hr/',
      auth: 'oauth',
      notes: 'Open-data REST API; client credentials after registration. Sole traders (obrti) are in the separate Obrtni registar.',
    },
  },
  holidays: hrHolidays,
  deadlines: hrDeadlines,
  supportLevel: 'pack',
  verifiedAt: '2026-10-28',
  caveats: [
    'Fiskalizacija 2.0 is a blocker for HR tenants: from 2026-01-01 VAT-registered issuers must send structured eRačuni (HR CIUS of EN 16931) through an intermediary and fiscalize them; a PDF invoice is no longer a valid B2B invoice. Billanta needs an intermediary integration or must stay drafts-only for HR.',
    'B2C invoices are fiscalized (JIR/ZKI, QR on the receipt) for every payment method from 2026; Billanta does not fiscalize.',
    'The 2027 issuing obligation for non-VAT taxpayers comes from Porezna uprava guidance; the law was amended in NN 153/25 – re-read the consolidated text.',
    'Small-business invoice note: "čl. 90. st. 1." is common practice; some advisers cite st. 2. Confirm the wording with a Croatian accountant.',
    'Invoice numbering under fiscalization has a fixed shape (sequence/premises/device) and premises must be registered first; the contract has no field for that.',
    'Simplified invoices: no threshold set here, not confirmed.',
    'Payment reference: Croatia uses HR-model references (HR00, HR01, HR99) on the HUB3 slip; the contract has no HR-model reference kind, so free_text is used.',
    'Article numbers in invoice.requirements are from the consolidated Zakon o PDV-u and were not re-read against the 2026 text.',
  ],
  sources: [ZPDV, ZFISK, PU_ERACUN, PU_GUIDE, THRESHOLD_2025, B2G, { title: 'Zakon o blagdanima (NN 110/19)', url: 'https://narodne-novine.nn.hr/clanci/sluzbeni/2019_11_110_2212.html' }],
};
