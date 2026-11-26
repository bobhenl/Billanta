import type { CountryPack, Source } from '../types.js';
import { luDeadlines, luHolidays } from './calendar.js';
import { normalizeLuRcs, normalizeLuVat, validateLuRcs, validateLuVat } from './tax-ids.js';

export * from './tax-ids.js';
export * from './calendar.js';

const LOI_TVA: Source = {
  title: 'Loi modifiée du 12 février 1979 concernant la TVA (art. 61–63 factures, art. 57bis franchise)',
  url: 'https://legilux.public.lu/eli/etat/leg/loi/1979/02/12/n1/consolide',
};
const AED_TVA: Source = {
  title: 'AED – Taxe sur la valeur ajoutée',
  url: 'https://pfi.public.lu/fr/tva.html',
};
const AED_SME: Source = {
  title: 'AED – Régime de franchise des petites entreprises (FAQ)',
  url: 'https://pfi.public.lu/dam-assets/pdf/tva/sme/faq-fr.pdf',
};
const LU_EINVOICING: Source = {
  title: 'Loi du 16 mai 2019 relative à la facturation électronique dans les marchés publics',
  url: 'https://legilux.public.lu/eli/etat/leg/loi/2019/05/16/a344/jo',
};
const EY_B2B: Source = {
  title: 'EY – Luxembourg moves closer to mandatory B2B e-invoicing (31 July 2026)',
  url: 'https://taxnews.ey.com/news/2026-1657-luxembourg-moves-closer-to-mandatory-b2b-e-invoicing',
};

export const LU: CountryPack = {
  code: 'LU',
  name: 'Luxembourg',
  region: 'eu',
  euMember: true,
  currency: 'EUR',
  currencyMinorUnits: 2,
  timeZone: 'Europe/Luxembourg',
  locales: ['fr', 'de', 'en'],
  taxIds: [
    {
      kind: 'company',
      label: { fr: 'Numéro RCS', de: 'RCS-Nummer', en: 'Trade register number (RCS)' },
      example: 'B12345',
      normalize: normalizeLuRcs,
      validate: validateLuRcs,
      // Loi du 19 décembre 2002 art. 26: "R.C.S. Luxembourg" + number on invoices and letters.
      requiredOnInvoice: true,
      source: { title: 'Luxembourg Business Registers', url: 'https://www.lbr.lu' },
    },
    {
      kind: 'vat',
      label: { fr: 'Numéro de TVA', de: 'MwSt-Nummer', en: 'VAT number' },
      example: 'LU15027442',
      normalize: normalizeLuVat,
      validate: validateLuVat,
      requiredOnInvoice: true,
      source: LOI_TVA,
    },
  ],
  indirectTax: {
    kind: 'vat',
    name: { fr: 'TVA', de: 'MwSt', en: 'VAT' },
    // Loi TVA art. 39–40; the 2023 one-point cut (loi du 26 octobre 2022) applied to the whole of 2023.
    rateSets: [
      {
        validFrom: '2015-01-01',
        rates: [
          { rate: 17, kind: 'standard' },
          { rate: 14, kind: 'parking', appliesTo: 'some wines, solid fuels, securities management' },
          { rate: 8, kind: 'reduced', appliesTo: 'gas, electricity, hairdressing, small repairs' },
          { rate: 3, kind: 'super_reduced', appliesTo: 'food, books, medicines, passenger transport, restaurants' },
        ],
      },
      {
        validFrom: '2023-01-01',
        rates: [
          { rate: 16, kind: 'standard' },
          { rate: 13, kind: 'parking' },
          { rate: 7, kind: 'reduced' },
          { rate: 3, kind: 'super_reduced' },
        ],
      },
      {
        validFrom: '2024-01-01',
        rates: [
          { rate: 17, kind: 'standard' },
          { rate: 14, kind: 'parking', appliesTo: 'some wines, solid fuels, securities management' },
          { rate: 8, kind: 'reduced', appliesTo: 'gas, electricity, hairdressing, small repairs' },
          { rate: 3, kind: 'super_reduced', appliesTo: 'food, books, medicines, passenger transport, restaurants' },
        ],
      },
    ],
    smallBusiness: {
      // Loi TVA art. 57bis: EUR 50,000 since 2025-01-01 (was 35,000), tolerance EUR 55,000.
      threshold: 50_000,
      currency: 'EUR',
      invoiceNote: {
        fr: 'Franchise de TVA – art. 57bis de la loi TVA',
        de: 'Steuerbefreiung für Kleinunternehmen – Art. 57bis MwSt-Gesetz',
        en: 'VAT exempt small enterprise – art. 57bis of the Luxembourg VAT law',
      },
      source: AED_SME,
    },
    reverseChargeNote: {
      // Loi TVA art. 63, 12°: the mention "Autoliquidation".
      domestic: { fr: 'Autoliquidation', de: 'Steuerschuldnerschaft des Leistungsempfängers', en: 'Reverse charge' },
      crossBorder: { fr: 'Autoliquidation', de: 'Steuerschuldnerschaft des Leistungsempfängers', en: 'Reverse charge' },
    },
    source: AED_TVA,
  },
  invoice: {
    // Loi TVA art. 63 lists the mentions.
    requirements: [
      { field: 'issue_date', rule: 'Loi TVA art. 63, 1°' },
      { field: 'invoice_number', rule: 'Loi TVA art. 63, 2°' },
      { field: 'supplier_vat_id', when: 'tax_registered', rule: 'Loi TVA art. 63, 3°' },
      { field: 'customer_vat_id', when: 'cross_border', rule: 'Loi TVA art. 63, 4°' },
      { field: 'supplier_name', rule: 'Loi TVA art. 63, 5°' },
      { field: 'supplier_address', rule: 'Loi TVA art. 63, 5°' },
      { field: 'customer_name', rule: 'Loi TVA art. 63, 5°' },
      { field: 'customer_address', rule: 'Loi TVA art. 63, 5°' },
      { field: 'line_quantity', rule: 'Loi TVA art. 63, 6°' },
      { field: 'line_description', rule: 'Loi TVA art. 63, 6°' },
      { field: 'supply_date', rule: 'Loi TVA art. 63, 7°' },
      { field: 'line_unit_price', rule: 'Loi TVA art. 63, 8°' },
      { field: 'tax_rate_per_line', rule: 'Loi TVA art. 63, 9°' },
      { field: 'tax_amount_per_rate', rule: 'Loi TVA art. 63, 10°' },
      { field: 'total_with_tax', rule: 'Loi TVA art. 63, 8°–10°' },
      { field: 'supplier_company_id', rule: 'Loi du 19 décembre 2002 art. 26 (RCS)' },
      { field: 'tax_in_local_currency', rule: 'Loi TVA art. 63; Directive 2006/112/EC art. 230' },
    ],
    // RGD du 1er décembre 2017 art. 1: simplified invoice up to EUR 100 incl. VAT.
    simplifiedThreshold: { amount: 100, currency: 'EUR' },
    numbering: { gapless: true, multipleSeries: true },
    homeCurrencyTaxRequired: true,
    // Loi TVA art. 65: 10 years.
    retentionYears: 10,
    source: LOI_TVA,
  },
  einvoicing: [
    {
      // Phased in 2022–2023; all suppliers of public bodies since 2023-03-18.
      scope: 'b2g',
      model: 'peppol_exchange',
      from: 'in_force',
      appliesTo: 'all suppliers of public contracting authorities',
      formats: ['peppol_bis'],
      platform: 'Peppol',
      source: LU_EINVOICING,
    },
    {
      // Draft law approved by the government on 2026-07-17; not yet enacted.
      scope: 'b2b',
      model: 'peppol_exchange',
      from: '2028-01-01',
      appliesTo: 'DRAFT – every business must be able to receive; issuing from 2028-07-01 (large and medium) and 2029-01-01 (all others)',
      formats: ['peppol_bis'],
      platform: 'Peppol',
      source: EY_B2B,
    },
  ],
  payments: {
    iban: true,
    qr: ['epc'],
    reference: 'free_text',
    localMethods: ['sepa', 'payconiq', 'wero'],
  },
  registry: {
    name: 'Luxembourg Business Registers (RCS)',
    url: 'https://www.lbr.lu',
  },
  holidays: luHolidays,
  deadlines: luDeadlines,
  supportLevel: 'pack',
  verifiedAt: '2026-10-21',
  caveats: [
    'Franchise invoice wording is ours: the law asks for a reference to the exemption provision (art. 57bis) or another indication of exemption, not a fixed text. The 57bis article number comes from secondary sources.',
    'B2B e-invoicing (receive 2028-01-01, issue 2028-07-01 / 2029-01-01) is a draft law approved on 2026-07-17; dates may change. No domestic e-reporting planned according to EY; Sovos expects one.',
    'Filing frequency bands (EUR 112,000 / 620,000) and the 15th-of-the-month rule from secondary sources; the AED may set other dates per business.',
    'RCS number format is checked loosely (section letter + digits); the register has no check digit.',
    'Payconiq in Luxembourg may be migrating to Wero like in Belgium (not confirmed).',
    'Invoice mention numbering in Loi TVA art. 63 cited from memory of the consolidated text; re-read on Legilux.',
  ],
  sources: [LOI_TVA, AED_TVA, AED_SME, LU_EINVOICING, EY_B2B],
};
