import type { CountryPack, Source } from '../types.js';
import { nlDeadlines, nlHolidays } from './calendar.js';
import { normalizeKvk, normalizeNlVat, validateKvk, validateNlVat } from './tax-ids.js';

export * from './tax-ids.js';
export * from './calendar.js';

const BD_INVOICE: Source = {
  title: 'Belastingdienst – Welke gegevens moet een factuur bevatten?',
  url: 'https://www.belastingdienst.nl/wps/wcm/connect/nl/btw/content/welke-gegevens-moet-een-factuur-bevatten',
};
const BD_KOR: Source = {
  title: 'Belastingdienst – Kleineondernemersregeling (KOR)',
  url: 'https://www.belastingdienst.nl/wps/wcm/connect/nl/btw/content/kleineondernemersregeling',
};
const BD_RATES: Source = {
  title: 'Belastingdienst – Btw-tarieven',
  url: 'https://www.belastingdienst.nl/wps/wcm/connect/nl/btw/content/btw-tarief-berekenen',
};
const WET_OB: Source = {
  title: 'Wet op de omzetbelasting 1968, art. 35a',
  url: 'https://wetten.overheid.nl/BWBR0002629/#HoofdstukII_Afdeling6_Artikel35a',
};
const BD_BTW_ID: Source = {
  title: 'Belastingdienst – Btw-identificatienummer',
  url: 'https://www.belastingdienst.nl/wps/wcm/connect/nl/btw/content/btw-identificatienummer',
};

export const NL: CountryPack = {
  code: 'NL',
  name: 'Netherlands',
  region: 'eu',
  euMember: true,
  currency: 'EUR',
  currencyMinorUnits: 2,
  timeZone: 'Europe/Amsterdam',
  locales: ['nl', 'en'],
  taxIds: [
    {
      kind: 'company',
      label: { nl: 'KvK-nummer', en: 'Chamber of Commerce number (KvK)' },
      example: '12345678',
      normalize: normalizeKvk,
      validate: validateKvk,
      // Handelsregisterbesluit 2008 art. 20: KvK number on invoices and business letters.
      requiredOnInvoice: true,
      source: { title: 'KvK – Handelsregister', url: 'https://www.kvk.nl' },
    },
    {
      kind: 'vat',
      label: { nl: 'Btw-id', en: 'VAT ID' },
      example: 'NL000099998B57',
      normalize: normalizeNlVat,
      validate: validateNlVat,
      requiredOnInvoice: true,
      source: BD_BTW_ID,
    },
  ],
  indirectTax: {
    kind: 'vat',
    name: { nl: 'btw', en: 'VAT' },
    // Wet OB art. 9 and tables I and II.
    rateSets: [
      {
        validFrom: '2012-10-01',
        rates: [
          { rate: 21, kind: 'standard' },
          { rate: 6, kind: 'reduced' },
          { rate: 0, kind: 'zero', appliesTo: 'exports and intra-EU supplies' },
        ],
      },
      {
        validFrom: '2019-01-01',
        rates: [
          { rate: 21, kind: 'standard' },
          { rate: 9, kind: 'reduced', appliesTo: 'food, water, medicines, books, culture, passenger transport, hairdressers' },
          { rate: 0, kind: 'zero', appliesTo: 'exports and intra-EU supplies' },
        ],
      },
    ],
    smallBusiness: {
      // Wet OB art. 25 (KOR), EUR 20,000 turnover since 2020.
      threshold: 20_000,
      currency: 'EUR',
      invoiceNote: {
        nl: 'Vrijgesteld van btw op grond van de kleineondernemersregeling (KOR)',
        en: 'Exempt from VAT under the small business scheme (KOR)',
      },
      source: BD_KOR,
    },
    reverseChargeNote: {
      // Wet OB art. 35a lid 1 onder i: "btw verlegd".
      domestic: { nl: 'Btw verlegd', en: 'VAT reverse-charged' },
      crossBorder: { nl: 'Btw verlegd', en: 'VAT reverse-charged' },
    },
    source: BD_RATES,
  },
  invoice: {
    // Wet OB 1968 art. 35a lid 1.
    requirements: [
      { field: 'issue_date', rule: 'Wet OB art. 35a lid 1 onder a' },
      { field: 'invoice_number', rule: 'Wet OB art. 35a lid 1 onder b' },
      { field: 'supplier_vat_id', when: 'tax_registered', rule: 'Wet OB art. 35a lid 1 onder c' },
      { field: 'customer_vat_id', when: 'cross_border', rule: 'Wet OB art. 35a lid 1 onder d' },
      { field: 'supplier_name', rule: 'Wet OB art. 35a lid 1 onder e' },
      { field: 'supplier_address', rule: 'Wet OB art. 35a lid 1 onder e' },
      { field: 'customer_name', rule: 'Wet OB art. 35a lid 1 onder e' },
      { field: 'customer_address', rule: 'Wet OB art. 35a lid 1 onder e' },
      { field: 'line_quantity', rule: 'Wet OB art. 35a lid 1 onder f' },
      { field: 'line_description', rule: 'Wet OB art. 35a lid 1 onder f' },
      { field: 'supply_date', rule: 'Wet OB art. 35a lid 1 onder g' },
      { field: 'line_unit_price', rule: 'Wet OB art. 35a lid 1 onder h' },
      { field: 'tax_rate_per_line', rule: 'Wet OB art. 35a lid 1 onder i' },
      { field: 'tax_amount_per_rate', rule: 'Wet OB art. 35a lid 1 onder j' },
      { field: 'total_with_tax', rule: 'Wet OB art. 35a lid 1 onder h–j' },
      { field: 'supplier_company_id', rule: 'Handelsregisterbesluit 2008 art. 20' },
      { field: 'tax_in_local_currency', rule: 'Wet OB art. 35a lid 2; Directive 2006/112/EC art. 230' },
    ],
    // Uitvoeringsbesluit OB 1968 art. 5a: simplified invoice up to EUR 100 incl. VAT.
    simplifiedThreshold: { amount: 100, currency: 'EUR' },
    numbering: { gapless: true, multipleSeries: true },
    homeCurrencyTaxRequired: true,
    // AWR art. 52 lid 4: 7 years (10 for real-estate invoices).
    retentionYears: 7,
    source: WET_OB,
  },
  einvoicing: [
    {
      // Central government accepts only e-invoices since 2017-01-01 (Peppol, NLCIUS).
      scope: 'b2g',
      model: 'peppol_exchange',
      from: 'in_force',
      appliesTo: 'suppliers of central government; most other public bodies accept Peppol',
      formats: ['peppol_bis', 'nlcius'],
      platform: 'Peppol / Digipoort',
      source: { title: 'Logius – E-factureren', url: 'https://www.logius.nl/domeinen/gegevensuitwisseling/e-factureren' },
    },
  ],
  payments: {
    iban: true,
    reference: 'free_text',
    localMethods: ['sepa', 'ideal', 'wero'],
  },
  registry: {
    name: 'KvK Handelsregister',
    url: 'https://www.kvk.nl/zoeken/',
    api: {
      url: 'https://developers.kvk.nl',
      auth: 'api_key',
      notes: 'Paid subscription plus per-call fees for Basisprofiel; the Zoeken API returns name, KvK number and address.',
    },
  },
  holidays: nlHolidays,
  deadlines: nlDeadlines,
  supportLevel: 'pack',
  verifiedAt: '2026-10-21',
  caveats: [
    'KOR invoice wording is ours: the law sets no fixed text. KOR participants need not invoice private customers.',
    'Domestic B2B e-invoicing on EN 16931 / Peppol announced on 2026-09-11, expected from 2030-07-01 with digital reporting later; not yet law, so not listed as a mandate.',
    'Never print the old omzetbelastingnummer that contained the BSN; sole traders use the btw-id issued since 2020.',
    'iDEAL is migrating to iDEAL | Wero (EPI) during 2025–2027; a pay link needs a PSP. EPC QR is rarely scanned in NL, so no QR scheme is listed.',
    'nlHolidays follows the Algemene termijnenwet (days that extend legal terms), not the days off in a given collective agreement.',
    'The KvK example is a format placeholder; the KvK number has no check digit.',
  ],
  sources: [WET_OB, BD_INVOICE, BD_KOR, BD_RATES, BD_BTW_ID],
};
