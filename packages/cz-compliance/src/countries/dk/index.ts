import type { CountryPack, CountryTaxDeadline, Source } from '../types.js';
import { easterOffset, isoList, nextWorkingDay, ymd } from '../se/calendar.js';
import { isValidCvr, isValidDkVat, normalizeCvr, normalizeDkVat } from './ids.js';

export * from './ids.js';

const SKAT_MOMS: Source = { title: 'Skattestyrelsen – Moms', url: 'https://skat.dk/erhverv/moms' };
const THRESHOLD: Source = {
  title: 'Den juridiske vejledning D.A.14.2.2.2 – Fritagelse for registrering (ML § 48, 50.000 kr.)',
  url: 'https://www.tax.dk/jv/da/D_A_14_2_2_2.htm',
};
const NEMHANDEL: Source = { title: 'NemHandel – e-faktura til det offentlige', url: 'https://nemhandel.dk' };
const BOGFORING: Source = {
  title: 'Erhvervsstyrelsen – Digital bogføring (bogføringsloven)',
  url: 'https://erhvervsstyrelsen.dk/digital-bogfoering',
};
const CVR: Source = { title: 'Det Centrale Virksomhedsregister', url: 'https://datacvr.virk.dk' };

/**
 * Days off: the public holidays of the Danish church calendar without Store
 * Bededag (abolished from 2024 by lov nr. 1 af 28. februar 2023), plus
 * Grundlovsdag, Christmas Eve and New Year's Eve, on which banks are closed.
 */
function holidays(year: number): string[] {
  return isoList([
    ymd(year, 1, 1),
    easterOffset(year, -3), // skærtorsdag
    easterOffset(year, -2), // langfredag
    easterOffset(year, 0),
    easterOffset(year, 1),
    easterOffset(year, 39), // Kristi himmelfartsdag
    easterOffset(year, 49), // pinsedag
    easterOffset(year, 50), // 2. pinsedag
    ymd(year, 6, 5), // grundlovsdag (bank holiday, not an official one)
    ymd(year, 12, 24),
    ymd(year, 12, 25),
    ymd(year, 12, 26),
    ymd(year, 12, 31),
  ]);
}

/**
 * Momsangivelse due dates (opkrævningsloven § 2, ML § 57): quarterly filers on
 * the 1st of the third month after the quarter, half-yearly filers on 1 March
 * and 1 September. Moved to the next banking day.
 */
function deadlines(year: number): CountryTaxDeadline[] {
  const off = holidays(year);
  const quarterly = [ymd(year, 3, 1), ymd(year, 6, 1), ymd(year, 9, 1), ymd(year, 12, 1)].map((d) => ({
    date: nextWorkingDay(d, off),
    kind: 'vat_return_quarterly',
    title: { da: 'Momsangivelse (kvartal)', en: 'VAT return (quarterly)' },
    appliesTo: 'VAT filers with turnover DKK 5–50 million, and new businesses',
  }));
  const halfYearly = [ymd(year, 3, 1), ymd(year, 9, 1)].map((d) => ({
    date: nextWorkingDay(d, off),
    kind: 'vat_return_half_yearly',
    title: { da: 'Momsangivelse (halvår)', en: 'VAT return (half-yearly)' },
    appliesTo: 'VAT filers with turnover below DKK 5 million',
  }));
  return [...quarterly, ...halfYearly];
}

export const DK: CountryPack = {
  code: 'DK',
  name: 'Denmark',
  region: 'eu',
  euMember: true,
  currency: 'DKK',
  currencyMinorUnits: 2,
  // Cash totals round to the nearest 50 øre.
  cashRounding: 0.5,
  timeZone: 'Europe/Copenhagen',
  locales: ['da', 'en'],
  taxIds: [
    {
      kind: 'company',
      label: { da: 'CVR-nummer', en: 'CVR number' },
      example: '13585628',
      normalize: normalizeCvr,
      validate: isValidCvr,
      // Momsbekendtgørelsen § 58 stk. 1 nr. 3: the supplier's CVR/SE number.
      requiredOnInvoice: true,
      source: CVR,
    },
    {
      kind: 'vat',
      label: { da: 'Momsnummer', en: 'VAT number' },
      example: 'DK13585628',
      normalize: normalizeDkVat,
      validate: isValidDkVat,
      requiredOnInvoice: false,
      source: SKAT_MOMS,
    },
  ],
  indirectTax: {
    kind: 'vat',
    name: { da: 'Moms', en: 'VAT' },
    // ML § 33: a single 25 % rate; § 34 zero rate for newspapers among others.
    rateSets: [
      {
        validFrom: '1992-01-01',
        rates: [
          { rate: 25, kind: 'standard' },
          { rate: 0, kind: 'zero', appliesTo: 'newspapers, intra-EU supplies, exports' },
        ],
      },
    ],
    smallBusiness: {
      // ML § 48: turnover up to DKK 50,000 per calendar year (calendar-year test since 1 Jan 2025).
      threshold: 50_000,
      currency: 'DKK',
      invoiceNote: {
        da: 'Virksomheden er ikke momsregistreret (momslovens § 48).',
        en: 'The business is not VAT registered (Danish VAT Act § 48).',
      },
      source: THRESHOLD,
    },
    reverseChargeNote: {
      domestic: { da: 'Omvendt betalingspligt', en: 'Reverse charge' },
      crossBorder: { da: 'Omvendt betalingspligt', en: 'Reverse charge' },
    },
    source: SKAT_MOMS,
  },
  invoice: {
    // Momsbekendtgørelsen § 58 (full invoice), § 61 (simplified, up to DKK 3,000).
    requirements: [
      { field: 'issue_date', rule: 'Momsbek. § 58 stk. 1 nr. 1' },
      { field: 'invoice_number', rule: 'Momsbek. § 58 stk. 1 nr. 2' },
      { field: 'supplier_company_id', rule: 'Momsbek. § 58 stk. 1 nr. 3' },
      { field: 'customer_vat_id', when: 'cross_border', rule: 'Momsbek. § 58 stk. 1 nr. 4' },
      { field: 'supplier_name', rule: 'Momsbek. § 58 stk. 1 nr. 5' },
      { field: 'supplier_address', rule: 'Momsbek. § 58 stk. 1 nr. 5' },
      { field: 'customer_name', rule: 'Momsbek. § 58 stk. 1 nr. 5' },
      { field: 'customer_address', rule: 'Momsbek. § 58 stk. 1 nr. 5' },
      { field: 'line_description', rule: 'Momsbek. § 58 stk. 1 nr. 6' },
      { field: 'line_quantity', rule: 'Momsbek. § 58 stk. 1 nr. 6' },
      { field: 'supply_date', rule: 'Momsbek. § 58 stk. 1 nr. 7' },
      { field: 'line_unit_price', rule: 'Momsbek. § 58 stk. 1 nr. 8' },
      { field: 'tax_rate_per_line', rule: 'Momsbek. § 58 stk. 1 nr. 9' },
      { field: 'tax_amount_per_rate', rule: 'Momsbek. § 58 stk. 1 nr. 10' },
      { field: 'tax_in_local_currency', rule: 'Momsbek. § 58 stk. 4 (art. 230 VAT Directive)' },
    ],
    simplifiedThreshold: { amount: 3_000, currency: 'DKK' },
    numbering: { gapless: false, multipleSeries: true },
    homeCurrencyTaxRequired: true,
    // Bogføringsloven § 12: 5 years from the end of the financial year.
    retentionYears: 5,
    source: SKAT_MOMS,
  },
  einvoicing: [
    {
      scope: 'b2g',
      model: 'peppol_exchange',
      from: '2005-02-01',
      appliesTo: 'all invoices to Danish public authorities',
      formats: ['oioubl', 'peppol_bis'],
      platform: 'NemHandel',
      source: NEMHANDEL,
    },
  ],
  payments: {
    iban: true,
    // FI-kort (+71/+73/+75) has a Luhn payment ID (see isValidFik); the contract has no 'dk_fik' kind yet.
    reference: 'free_text',
    localMethods: ['fik', 'mobilepay', 'betalingsservice'],
  },
  registry: { name: 'CVR (Erhvervsstyrelsen)', url: 'https://datacvr.virk.dk' },
  holidays,
  deadlines,
  supportLevel: 'pack',
  verifiedAt: '2026-10-28',
  caveats: [
    'Bogføringsloven requires a registered digital bookkeeping system able to send and receive e-invoices (phased in to 2026, turnover > DKK 300,000); this is a capability rule, not a sending mandate, and the contract cannot express it.',
    'No B2B e-invoicing mandate yet; one is expected around ViDA (~2030). OIOUBL vs Peppol BIS transition dates not confirmed.',
    'Momsbekendtgørelsen § 58 field numbering and the DKK 3,000 simplified limit are from memory, not re-read.',
    'Monthly filers (turnover > DKK 50 million, due the 25th of the following month) are not in deadlines().',
    'FIK check digit rules (Luhn for card 71/75) not confirmed against the official FI-kort specification.',
  ],
  sources: [SKAT_MOMS, THRESHOLD, NEMHANDEL, BOGFORING, CVR],
};
