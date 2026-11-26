import type { CountryPack, CountryTaxDeadline, Source } from '../types.js';
import { easterOffset, isoList, nextWorkingDay, weekdayOnOrAfter, ymd } from '../se/calendar.js';
import { isValidFiVat, isValidYTunnus, normalizeFiVat, normalizeYTunnus } from './ids.js';

export * from './ids.js';

const AVL: Source = {
  title: 'Arvonlisäverolaki 1501/1993 (Finlex)',
  url: 'https://www.finlex.fi/fi/laki/ajantasa/1993/19931501',
};
const VERO_VAT: Source = {
  title: 'Vero.fi – VAT (arvonlisävero)',
  url: 'https://www.vero.fi/en/businesses-and-corporations/taxes-and-charges/vat/',
};
const VERO_RATES: Source = {
  title: 'Vero.fi – VAT rates',
  url: 'https://www.vero.fi/en/businesses-and-corporations/taxes-and-charges/vat/rates-of-vat/',
};
const EINVOICE_LAW: Source = {
  title: 'Laki sähköisestä laskutuksesta 241/2019 (Finlex)',
  url: 'https://www.finlex.fi/fi/laki/alkup/2019/20190241',
};
const YTJ: Source = { title: 'YTJ – Business Information System', url: 'https://www.ytj.fi' };
const HOLIDAYS: Source = {
  title: 'Vuosilomalaki / Bank of Finland – Finnish public holidays and bank days',
  url: 'https://www.suomenpankki.fi/en/money-and-payments/',
};

/**
 * Days off: the Finnish church and national holidays plus Midsummer Eve and
 * Christmas Eve, on which banks are closed and OmaVero due dates move on.
 */
function holidays(year: number): string[] {
  return isoList([
    ymd(year, 1, 1),
    ymd(year, 1, 6), // loppiainen
    easterOffset(year, -2), // pitkäperjantai
    easterOffset(year, 0),
    easterOffset(year, 1),
    ymd(year, 5, 1),
    easterOffset(year, 39), // helatorstai
    easterOffset(year, 49), // helluntai
    weekdayOnOrAfter(year, 6, 19, 5), // juhannusaatto, Friday 19–25 June
    weekdayOnOrAfter(year, 6, 20, 6), // juhannuspäivä, Saturday 20–26 June
    weekdayOnOrAfter(year, 10, 31, 6), // pyhäinpäivä, Saturday 31 Oct–6 Nov
    ymd(year, 12, 6), // itsenäisyyspäivä
    ymd(year, 12, 24),
    ymd(year, 12, 25),
    ymd(year, 12, 26),
  ]);
}

/**
 * Oma-aloitteisten verojen ilmoitus ja maksu (laki oma-aloitteisten verojen
 * verotusmenettelystä 768/2016, § 15–16): the 12th of the second month after a
 * monthly or quarterly period; annual filers (turnover up to EUR 100,000) by
 * the end of February. Moved to the next banking day.
 */
function deadlines(year: number): CountryTaxDeadline[] {
  const off = holidays(year);
  const monthly = Array.from({ length: 12 }, (_, i) => ({
    date: nextWorkingDay(ymd(year, i + 1, 12), off),
    kind: 'vat_return_monthly',
    title: { fi: 'Arvonlisäveroilmoitus (kuukausi)', sv: 'Momsdeklaration (månad)', en: 'VAT return (monthly)' },
    appliesTo: 'monthly VAT filers (period two months earlier)',
  }));
  const quarterly = [2, 5, 8, 11].map((m) => ({
    date: nextWorkingDay(ymd(year, m, 12), off),
    kind: 'vat_return_quarterly',
    title: { fi: 'Arvonlisäveroilmoitus (neljännesvuosi)', sv: 'Momsdeklaration (kvartal)', en: 'VAT return (quarterly)' },
    appliesTo: 'quarterly filers, turnover up to EUR 500,000',
  }));
  const annual = {
    date: nextWorkingDay(new Date(year, 2, 0), off), // last day of February
    kind: 'vat_return_annual',
    title: { fi: 'Arvonlisäveroilmoitus (vuosi)', sv: 'Momsdeklaration (år)', en: 'VAT return (annual)' },
    appliesTo: 'annual filers, turnover up to EUR 100,000 (previous year)',
  };
  return [...monthly, ...quarterly, annual].sort((a, b) => a.date.localeCompare(b.date));
}

export const FI: CountryPack = {
  code: 'FI',
  name: 'Finland',
  region: 'eu',
  euMember: true,
  currency: 'EUR',
  currencyMinorUnits: 2,
  // Cash totals round to 5 cents (Suomen Pankki rounding rule).
  cashRounding: 0.05,
  timeZone: 'Europe/Helsinki',
  locales: ['fi', 'sv', 'en'],
  taxIds: [
    {
      kind: 'company',
      label: { fi: 'Y-tunnus', sv: 'FO-nummer', en: 'Business ID' },
      example: '0112038-9',
      normalize: normalizeYTunnus,
      validate: isValidYTunnus,
      requiredOnInvoice: true,
      source: YTJ,
    },
    {
      kind: 'vat',
      label: { fi: 'ALV-numero', sv: 'Momsnummer', en: 'VAT number' },
      example: 'FI01120389',
      normalize: normalizeFiVat,
      validate: isValidFiVat,
      // AVL 209 e § 1 mom. 3 kohta: the seller's VAT ID; the buyer's on reverse charge / intra-EU.
      requiredOnInvoice: true,
      source: VERO_VAT,
    },
  ],
  indirectTax: {
    kind: 'vat',
    name: { fi: 'Arvonlisävero (ALV)', sv: 'Mervärdesskatt (moms)', en: 'VAT' },
    // AVL 84 § (standard), 85 § (14 % → 13.5 %), 85 a § (10 %).
    rateSets: [
      {
        validFrom: '2013-01-01',
        rates: [
          { rate: 24, kind: 'standard' },
          { rate: 14, kind: 'reduced', appliesTo: 'food, restaurant and catering services' },
          {
            rate: 10,
            kind: 'reduced',
            appliesTo: 'books, newspapers, medicines, passenger transport, accommodation, culture and sport',
          },
          { rate: 0, kind: 'zero', appliesTo: 'intra-EU supplies, exports' },
        ],
      },
      {
        // Laki 309/2024: standard rate 24 % → 25.5 %.
        validFrom: '2024-09-01',
        rates: [
          { rate: 25.5, kind: 'standard' },
          { rate: 14, kind: 'reduced', appliesTo: 'food, restaurant and catering services' },
          {
            rate: 10,
            kind: 'reduced',
            appliesTo: 'books, newspapers, medicines, passenger transport, accommodation, culture and sport',
          },
          { rate: 0, kind: 'zero', appliesTo: 'intra-EU supplies, exports' },
        ],
      },
      {
        // Most 10 % items moved to 14 %; 10 % kept for newspapers, periodicals and public broadcasting.
        validFrom: '2025-01-01',
        rates: [
          { rate: 25.5, kind: 'standard' },
          {
            rate: 14,
            kind: 'reduced',
            appliesTo: 'food, restaurants, books, medicines, passenger transport, accommodation, culture and sport',
          },
          { rate: 10, kind: 'reduced', appliesTo: 'newspapers, periodicals, public broadcasting' },
          { rate: 0, kind: 'zero', appliesTo: 'intra-EU supplies, exports' },
        ],
      },
      {
        // Laki 1358/2025: 14 % → 13.5 %; public broadcasting 10 % → 13.5 %.
        validFrom: '2026-01-01',
        rates: [
          { rate: 25.5, kind: 'standard' },
          {
            rate: 13.5,
            kind: 'reduced',
            appliesTo:
              'food, restaurants, books, medicines, passenger transport, accommodation, culture and sport, public broadcasting',
          },
          { rate: 10, kind: 'reduced', appliesTo: 'newspapers and periodicals' },
          { rate: 0, kind: 'zero', appliesTo: 'intra-EU supplies, exports' },
        ],
      },
    ],
    smallBusiness: {
      // AVL 3 § (vähäinen toiminta): turnover up to EUR 20,000 per year since 1 Jan 2025 (was 15,000).
      threshold: 20_000,
      currency: 'EUR',
      invoiceNote: {
        fi: 'Myyjä ei ole arvonlisäverovelvollinen (AVL 3 §, vähäinen toiminta).',
        sv: 'Säljaren är inte momsskyldig (ML 3 §, verksamhet av ringa omfattning).',
        en: 'The seller is not liable for VAT (Finnish VAT Act § 3, small-scale business).',
      },
      source: VERO_VAT,
    },
    reverseChargeNote: {
      domestic: { fi: 'Käännetty verovelvollisuus', sv: 'Omvänd skattskyldighet', en: 'Reverse charge' },
      crossBorder: { fi: 'Käännetty verovelvollisuus', sv: 'Omvänd skattskyldighet', en: 'Reverse charge' },
    },
    source: VERO_RATES,
  },
  invoice: {
    // AVL 209 e § (full invoice), 209 f § (simplified invoice).
    requirements: [
      { field: 'issue_date', rule: 'AVL 209 e § 1 kohta' },
      { field: 'invoice_number', rule: 'AVL 209 e § 2 kohta' },
      { field: 'supplier_vat_id', rule: 'AVL 209 e § 3 kohta' },
      { field: 'customer_vat_id', when: 'cross_border', rule: 'AVL 209 e § 4 kohta' },
      { field: 'supplier_name', rule: 'AVL 209 e § 5 kohta' },
      { field: 'supplier_address', rule: 'AVL 209 e § 5 kohta' },
      { field: 'customer_name', rule: 'AVL 209 e § 5 kohta' },
      { field: 'customer_address', rule: 'AVL 209 e § 5 kohta' },
      { field: 'line_description', rule: 'AVL 209 e § 6 kohta' },
      { field: 'line_quantity', rule: 'AVL 209 e § 6 kohta' },
      { field: 'supply_date', rule: 'AVL 209 e § 7 kohta' },
      { field: 'line_unit_price', rule: 'AVL 209 e § 8 kohta' },
      { field: 'tax_rate_per_line', rule: 'AVL 209 e § 9 kohta' },
      { field: 'tax_amount_per_rate', rule: 'AVL 209 e § 10 kohta' },
      { field: 'tax_in_local_currency', rule: 'AVL 209 h § (VAT in euros)' },
    ],
    simplifiedThreshold: { amount: 400, currency: 'EUR' },
    numbering: { gapless: false, multipleSeries: true },
    homeCurrencyTaxRequired: true,
    // Kirjanpitolaki 2:10 §: vouchers (tositteet) for 6 years after the end of the financial year.
    retentionYears: 6,
    source: AVL,
  },
  einvoicing: [
    {
      scope: 'b2g',
      model: 'peppol_exchange',
      from: '2020-04-01',
      appliesTo: 'invoices to Finnish contracting authorities (laki 241/2019 § 4)',
      formats: ['finvoice', 'teapps', 'peppol_bis'],
      platform: 'Peppol / e-invoice operator network',
      source: EINVOICE_LAW,
    },
    {
      scope: 'b2b',
      model: 'post_audit',
      from: '2020-04-01',
      appliesTo: 'on the buyer’s request, suppliers with annual turnover over EUR 10,000 (laki 241/2019 § 4)',
      formats: ['finvoice', 'teapps', 'peppol_bis'],
      platform: 'e-invoice operator network (Finvoice via banks)',
      source: EINVOICE_LAW,
    },
  ],
  payments: {
    iban: true,
    // Finnish virtual bar code (virtuaaliviivakoodi) is the domestic QR/bar code; the contract has no key for it yet.
    qr: ['epc'],
    reference: 'fi_reference',
    localMethods: ['sepa', 'e-lasku', 'mobilepay'],
  },
  registry: {
    name: 'YTJ (PRH and Verohallinto)',
    url: 'https://www.ytj.fi',
    api: { url: 'https://avoindata.prh.fi', auth: 'none', notes: 'PRH open data YTJ API' },
  },
  holidays,
  deadlines,
  supportLevel: 'pack',
  verifiedAt: '2026-10-28',
  caveats: [
    'The 2025-01-01 split (which 10 % items moved to 14 %) and the 2026-01-01 move to 13.5 % (laki 1358/2025) come from press coverage; check the exact item lists against Vero.fi.',
    'Simplified invoice limit EUR 400 (AVL 209 f §) and the 6-year voucher retention are from memory, not re-read.',
    'AVL 209 e § item numbering is from memory.',
    'PRH open data API version and path not checked.',
    'The B2B e-invoice right applies on the buyer’s request only; there is no general B2B mandate before ViDA.',
    'Holiday list includes Midsummer Eve and Christmas Eve as bank holidays; the official holiday source link is general.',
  ],
  sources: [AVL, VERO_VAT, VERO_RATES, EINVOICE_LAW, YTJ, HOLIDAYS],
};
