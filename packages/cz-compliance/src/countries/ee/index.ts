import type { CountryPack, CountryTaxDeadline, Source } from '../types.js';
import { easterOffset, isoList, nextWorkingDay, ymd } from '../se/calendar.js';
import { isValidEeVat, isValidRegistrikood, normalizeEeVat, normalizeRegistrikood } from './ids.js';

export * from './ids.js';

const KMS: Source = {
  title: 'Käibemaksuseadus (Riigi Teataja)',
  url: 'https://www.riigiteataja.ee/akt/KMS',
};
const EMTA_VAT: Source = {
  title: 'Maksu- ja Tolliamet – Käibemaks',
  url: 'https://www.emta.ee/ariklient/maksud-ja-tasumine/kaibemaks',
};
const RPS: Source = {
  title: 'Raamatupidamise seadus (Riigi Teataja)',
  url: 'https://www.riigiteataja.ee/akt/RPS',
};
const EARVE: Source = {
  title: 'Rahandusministeerium – E-arve (e-invoicing)',
  url: 'https://www.fin.ee/riigihanked-riigiabi-osalused-kinnisvara/e-arve',
};
const PUHAD: Source = {
  title: 'Pühade ja tähtpäevade seadus (Riigi Teataja)',
  url: 'https://www.riigiteataja.ee/akt/PTS',
};
const ARIREGISTER: Source = { title: 'e-Äriregister', url: 'https://ariregister.rik.ee' };

/** Riigipühad of the Pühade ja tähtpäevade seadus § 2, plus Christmas Eve (also a day off). */
function holidays(year: number): string[] {
  return isoList([
    ymd(year, 1, 1),
    ymd(year, 2, 24), // iseseisvuspäev
    easterOffset(year, -2), // suur reede
    easterOffset(year, 0), // ülestõusmispühade 1. püha
    ymd(year, 5, 1),
    easterOffset(year, 49), // nelipühade 1. püha
    ymd(year, 6, 23), // võidupüha
    ymd(year, 6, 24), // jaanipäev
    ymd(year, 8, 20), // taasiseseisvumispäev
    ymd(year, 12, 24),
    ymd(year, 12, 25),
    ymd(year, 12, 26),
  ]);
}

/**
 * Käibedeklaratsioon (KMD) and the VAT payment are due on the 20th of the
 * month after the period (KMS § 27 lg 1). Moved to the next working day
 * (Maksukorralduse seadus § 6).
 */
function deadlines(year: number): CountryTaxDeadline[] {
  const off = holidays(year);
  return Array.from({ length: 12 }, (_, i) => ({
    date: nextWorkingDay(ymd(year, i + 1, 20), off),
    kind: 'vat_return_monthly',
    title: { et: 'Käibedeklaratsioon (KMD ja KMD INF)', en: 'VAT return (KMD with KMD INF)' },
    appliesTo: 'all VAT-registered businesses (previous month)',
  }));
}

export const EE: CountryPack = {
  code: 'EE',
  name: 'Estonia',
  region: 'eu',
  euMember: true,
  currency: 'EUR',
  currencyMinorUnits: 2,
  // Cash totals round to 5 cents since 1 Jan 2025 (Eesti Pank).
  cashRounding: 0.05,
  timeZone: 'Europe/Tallinn',
  locales: ['et', 'en'],
  taxIds: [
    {
      kind: 'company',
      label: { et: 'Registrikood', en: 'Registry code' },
      example: '10137319',
      normalize: normalizeRegistrikood,
      validate: isValidRegistrikood,
      requiredOnInvoice: false,
      source: ARIREGISTER,
    },
    {
      kind: 'vat',
      label: { et: 'KMKR number', en: 'VAT number' },
      example: 'EE100931558',
      normalize: normalizeEeVat,
      validate: isValidEeVat,
      // KMS § 37 lg 5 p 3: the seller's KMKR number.
      requiredOnInvoice: true,
      source: EMTA_VAT,
    },
  ],
  indirectTax: {
    kind: 'vat',
    name: { et: 'Käibemaks', en: 'VAT' },
    // KMS § 15.
    rateSets: [
      {
        validFrom: '2024-01-01',
        rates: [
          { rate: 22, kind: 'standard' },
          { rate: 9, kind: 'reduced', appliesTo: 'accommodation, books, medicines and medical devices' },
          { rate: 5, kind: 'reduced', appliesTo: 'press publications' },
          { rate: 0, kind: 'zero', appliesTo: 'intra-EU supplies, exports' },
        ],
      },
      {
        // Accommodation 9 % → 13 %, press 5 % → 9 %.
        validFrom: '2025-01-01',
        rates: [
          { rate: 22, kind: 'standard' },
          { rate: 13, kind: 'reduced', appliesTo: 'accommodation' },
          { rate: 9, kind: 'reduced', appliesTo: 'books, press publications, medicines and medical devices' },
          { rate: 0, kind: 'zero', appliesTo: 'intra-EU supplies, exports' },
        ],
      },
      {
        // Standard rate 22 % → 24 %, made permanent.
        validFrom: '2025-07-01',
        rates: [
          { rate: 24, kind: 'standard' },
          { rate: 13, kind: 'reduced', appliesTo: 'accommodation' },
          { rate: 9, kind: 'reduced', appliesTo: 'books, press publications, medicines and medical devices' },
          { rate: 0, kind: 'zero', appliesTo: 'intra-EU supplies, exports' },
        ],
      },
    ],
    smallBusiness: {
      // KMS § 19 lg 1: registration required above EUR 40,000 taxable turnover in a calendar year.
      threshold: 40_000,
      currency: 'EUR',
      invoiceNote: {
        et: 'Müüja ei ole käibemaksukohustuslasena registreeritud.',
        en: 'The seller is not registered for VAT.',
      },
      source: EMTA_VAT,
    },
    reverseChargeNote: {
      domestic: { et: 'Pöördmaksustamine (KMS § 41¹)', en: 'Reverse charge (Estonian VAT Act § 41¹)' },
      crossBorder: { et: 'Pöördmaksustamine', en: 'Reverse charge' },
    },
    source: KMS,
  },
  invoice: {
    // KMS § 37 lg 5 (arve rekvisiidid).
    requirements: [
      { field: 'invoice_number', rule: 'KMS § 37 lg 5 p 1' },
      { field: 'issue_date', rule: 'KMS § 37 lg 5 p 2' },
      { field: 'supplier_name', rule: 'KMS § 37 lg 5 p 3' },
      { field: 'supplier_address', rule: 'KMS § 37 lg 5 p 3' },
      { field: 'supplier_vat_id', rule: 'KMS § 37 lg 5 p 3' },
      { field: 'customer_name', rule: 'KMS § 37 lg 5 p 4' },
      { field: 'customer_address', rule: 'KMS § 37 lg 5 p 4' },
      { field: 'customer_vat_id', when: 'b2b', rule: 'KMS § 37 lg 5 p 4' },
      { field: 'line_description', rule: 'KMS § 37 lg 5 p 5' },
      { field: 'line_quantity', rule: 'KMS § 37 lg 5 p 5' },
      { field: 'supply_date', rule: 'KMS § 37 lg 5 p 6' },
      { field: 'line_unit_price', rule: 'KMS § 37 lg 5 p 7' },
      { field: 'tax_rate_per_line', rule: 'KMS § 37 lg 5 p 8' },
      { field: 'tax_amount_per_rate', rule: 'KMS § 37 lg 5 p 9' },
      { field: 'tax_in_local_currency', rule: 'KMS § 37 lg 9 (VAT in euros)' },
    ],
    numbering: { gapless: false, multipleSeries: true },
    homeCurrencyTaxRequired: true,
    // Raamatupidamise seadus § 12 lg 1: source documents for 7 years.
    retentionYears: 7,
    source: KMS,
  },
  einvoicing: [
    {
      scope: 'b2g',
      model: 'peppol_exchange',
      from: '2019-07-01',
      appliesTo: 'invoices to Estonian public-sector buyers (RPS § 52)',
      formats: ['e-arve', 'peppol_bis'],
      platform: 'e-invoice operators / Peppol',
      source: EARVE,
    },
    {
      scope: 'b2b',
      model: 'post_audit',
      from: '2025-07-01',
      appliesTo: 'on the buyer’s request, if the buyer is registered as an e-invoice recipient (RPS § 52)',
      formats: ['e-arve', 'peppol_bis'],
      platform: 'e-invoice operators / Peppol',
      source: RPS,
    },
  ],
  payments: {
    iban: true,
    qr: ['epc'],
    // Viitenumber uses the Finnish 7-3-1 check digit; the contract only names it 'fi_reference'.
    reference: 'fi_reference',
    localMethods: ['sepa', 'e-invoice'],
  },
  registry: {
    name: 'e-Äriregister (RIK)',
    url: 'https://ariregister.rik.ee',
    api: { url: 'https://avaandmed.ariregister.rik.ee', auth: 'none', notes: 'open data dumps; the SOAP API needs a contract' },
  },
  holidays,
  deadlines,
  supportLevel: 'pack',
  verifiedAt: '2026-10-28',
  caveats: [
    'A general B2B e-invoicing mandate from 2027 was discussed but is not confirmed; only the buyer-request rule (from 2025-07-01) is modelled.',
    'KMS § 37 subsection and item numbers are from memory.',
    'No fixed simplified-invoice amount was confirmed for Estonia, so none is set.',
    'Cash rounding to 5 cents from 2025 is reported by Eesti Pank news; check before showing it on invoices.',
    'Registry API notes (open data vs. paid SOAP) not checked.',
  ],
  sources: [KMS, EMTA_VAT, RPS, EARVE, PUHAD, ARIREGISTER],
};
