import type { CountryPack, CountryTaxDeadline } from '../types.js';
import { siHolidays, siLastWorkingDay } from './holidays.js';
import { isValidSiTaxNumber, normalizeSiTaxNumber } from './tax-id.js';

const ZDDV = { title: 'Zakon o davku na dodano vrednost (ZDDV-1)', url: 'https://pisrs.si/pregledPredpisa?id=ZAKO4701' };
const FURS_DDV = {
  title: 'FURS – Davek na dodano vrednost',
  url: 'https://www.fu.gov.si/davki_in_druge_dajatve/podrocja/davek_na_dodano_vrednost_ddv/',
};
const ERACUNI_ACT = {
  title: 'Zakon o izmenjavi elektronskih računov (adopted 23 October 2025), summary by BDO',
  url: 'https://www.bdo.global/en-gb/insights/tax/indirect-tax/slovenia-e-invoicing-to-be-mandatory-for-b2b-transactions-starting-in-2028',
};
const UJP = { title: 'UJP – e-računi za proračunske uporabnike', url: 'https://www.ujp.gov.si/storitve/e-racuni' };
const SMALL_BUSINESS = {
  title: 'PwC Slovenia – Novosti na področju DDV v letu 2025',
  url: 'https://www.pwc.com/si/sl/publications/tax-news/preverite-novosti-na-podrocju-DDV-v-letu-2025.html',
};

/** DDV-O is due on the last working day of the month after the period (ZDDV-1 art. 89). */
function siDeadlines(year: number): CountryTaxDeadline[] {
  return Array.from({ length: 12 }, (_, i) => ({
    date: siLastWorkingDay(year, i + 1),
    kind: 'vat_return',
    title: { sl: 'Obračun DDV (DDV-O) in plačilo DDV', en: 'VAT return (DDV-O) and VAT payment' },
    appliesTo: i % 3 === 0 ? 'monthly filers, and quarterly filers for the quarter just ended' : 'monthly VAT filers',
  }));
}

export const SI: CountryPack = {
  code: 'SI',
  name: 'Slovenia',
  region: 'eu',
  euMember: true,
  currency: 'EUR',
  currencyMinorUnits: 2,
  timeZone: 'Europe/Ljubljana',
  locales: ['sl', 'en'],
  taxIds: [
    {
      kind: 'vat',
      label: { sl: 'ID za DDV', en: 'VAT ID' },
      example: 'SI47939664',
      normalize: (v) => `SI${normalizeSiTaxNumber(v)}`,
      validate: (v) => /^SI\d{8}$/.test(v.replace(/\s/g, '').toUpperCase()) && isValidSiTaxNumber(v),
      requiredOnInvoice: true,
      source: ZDDV,
    },
    {
      kind: 'tax',
      label: { sl: 'Davčna številka', en: 'Tax number' },
      example: '47939664',
      normalize: normalizeSiTaxNumber,
      validate: isValidSiTaxNumber,
      requiredOnInvoice: false,
      source: { title: 'FURS – Davčna številka', url: 'https://www.fu.gov.si/davki_in_druge_dajatve/podrocja/davcna_stevilka/' },
    },
  ],
  indirectTax: {
    kind: 'vat',
    name: { sl: 'DDV', en: 'VAT' },
    // ZDDV-1 art. 41 (22 % and 9.5 % since 2013-07-01) and art. 41a (5 % from 2020, ZDDV-1M).
    rateSets: [
      {
        validFrom: '2013-07-01',
        rates: [
          { rate: 22, kind: 'standard' },
          { rate: 9.5, kind: 'reduced', appliesTo: 'food, water, medicines, passenger transport, accommodation, books' },
        ],
      },
      {
        validFrom: '2020-01-01',
        rates: [
          { rate: 22, kind: 'standard' },
          { rate: 9.5, kind: 'reduced', appliesTo: 'food, water, medicines, passenger transport, accommodation' },
          { rate: 5, kind: 'super_reduced', appliesTo: 'books, newspapers and periodicals, incl. electronic' },
        ],
      },
    ],
    smallBusiness: {
      // ZDDV-1 art. 94: EUR 60,000 from 2025 (was 50,000); the exemption ends once turnover passes EUR 66,000.
      threshold: 60000,
      currency: 'EUR',
      invoiceNote: {
        sl: 'DDV ni obračunan na podlagi 1. odstavka 94. člena ZDDV-1.',
        en: 'VAT not charged under Article 94(1) of the Slovenian VAT Act (ZDDV-1).',
      },
      source: SMALL_BUSINESS,
    },
    reverseChargeNote: {
      // ZDDV-1 art. 76a: domestic reverse charge (construction, scrap, emission allowances…).
      domestic: { sl: 'Obrnjena davčna obveznost – 76.a člen ZDDV-1.', en: 'Domestic reverse charge – Article 76a ZDDV-1.' },
      crossBorder: {
        sl: 'Obrnjena davčna obveznost – 196. člen Direktive 2006/112/ES.',
        en: 'Reverse charge – Article 196 of Directive 2006/112/EC.',
      },
    },
    source: FURS_DDV,
  },
  invoice: {
    // ZDDV-1 art. 82 lists the content; art. 81a allows simplified invoices up to EUR 100.
    requirements: [
      { field: 'issue_date', rule: 'art. 82(1)(1) ZDDV-1' },
      { field: 'invoice_number', rule: 'art. 82(1)(2) ZDDV-1' },
      { field: 'supplier_vat_id', when: 'tax_registered', rule: 'art. 82(1)(3) ZDDV-1' },
      { field: 'customer_vat_id', when: 'cross_border', rule: 'art. 82(1)(4) ZDDV-1' },
      { field: 'supplier_name', rule: 'art. 82(1)(5) ZDDV-1' },
      { field: 'supplier_address', rule: 'art. 82(1)(5) ZDDV-1' },
      { field: 'customer_name', rule: 'art. 82(1)(5) ZDDV-1' },
      { field: 'customer_address', rule: 'art. 82(1)(5) ZDDV-1' },
      { field: 'line_description', rule: 'art. 82(1)(6) ZDDV-1' },
      { field: 'line_quantity', rule: 'art. 82(1)(6) ZDDV-1' },
      { field: 'supply_date', rule: 'art. 82(1)(7) ZDDV-1' },
      { field: 'line_unit_price', rule: 'art. 82(1)(9) ZDDV-1' },
      { field: 'tax_rate_per_line', rule: 'art. 82(1)(10) ZDDV-1' },
      { field: 'tax_amount_per_rate', rule: 'art. 82(1)(11) ZDDV-1' },
      { field: 'tax_in_local_currency', rule: 'art. 85 ZDDV-1 (VAT shown in EUR)' },
    ],
    simplifiedThreshold: { amount: 100, currency: 'EUR' },
    numbering: { gapless: true, multipleSeries: true },
    language: { required: ['sl'], note: 'Domestic invoices in Slovenian (Zakon o javni rabi slovenščine); bilingual is fine.' },
    homeCurrencyTaxRequired: true,
    // ZDDV-1 art. 87: invoices are kept for 10 years after the year they relate to.
    retentionYears: 10,
    source: ZDDV,
  },
  einvoicing: [
    {
      scope: 'b2g',
      model: 'post_audit',
      from: 'in_force',
      appliesTo: 'all suppliers to public bodies (since 2015-01-01, ZOPSPU-1)',
      formats: ['eslog_2_0', 'peppol_bis'],
      platform: 'UJP e-računi / Peppol',
      source: UJP,
    },
    {
      scope: 'b2b',
      model: 'post_audit',
      from: '2028-01-01',
      appliesTo: 'entities in the Slovenian Business Register, sole traders included; domestic B2B only, no reporting to FURS',
      formats: ['eslog_2_0', 'en16931', 'peppol_bis'],
      platform: 'Peppol, accredited e-route providers, direct exchange or the free state app',
      source: ERACUNI_ACT,
    },
  ],
  payments: {
    iban: true,
    qr: ['upn_qr', 'epc'],
    reference: 'sepa_rf',
    localMethods: ['sepa', 'upn', 'flik'],
  },
  registry: {
    name: 'AJPES – Poslovni register Slovenije (ePRS)',
    url: 'https://www.ajpes.si/prs/',
  },
  holidays: siHolidays,
  deadlines: siDeadlines,
  supportLevel: 'pack',
  verifiedAt: '2026-10-21',
  caveats: [
    'Davčne blagajne (fiscal cash registers, ZDavPR): every invoice paid in cash (cards included) must be confirmed online by FURS (EOR/ZOI codes, business premises registered first). Billanta does not fiscalize; SI tenants taking cash need a certified register. https://www.fu.gov.si/davcne_blagajne/',
    'B2B e-invoicing from 2028-01-01: the Act was adopted on 23 October 2025; the date and channels come from adviser summaries (BDO, KPMG), not the official gazette text. Re-check before building the e-SLOG export.',
    'Small-business threshold EUR 60,000 from 2025 (ZDDV-1 art. 94) comes from the PwC summary; one older source still says EUR 50,000.',
    'The small-business invoice note is common practice, not prescribed wording.',
    'DDV-O deadline is the last working day of the following month (ZDDV-1 art. 89); quarterly filing is only for smaller payers – confirm the current limit with FURS.',
    'Payment references: Slovenia uses SI-model references (SI00, SI12) next to RF; the contract has no SI-model reference kind.',
    'Article numbers in invoice.requirements are from the consolidated ZDDV-1 and were not re-read against the 2026 text.',
  ],
  sources: [
    ZDDV,
    FURS_DDV,
    ERACUNI_ACT,
    UJP,
    SMALL_BUSINESS,
    { title: 'ZPDPD – Zakon o praznikih in dela prostih dnevih', url: 'https://pisrs.si/pregledPredpisa?id=ZAKO277' },
  ],
};
