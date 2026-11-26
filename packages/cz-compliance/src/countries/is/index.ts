import type { CountryPack, Source } from '../types.js';
import { isDeadlines, isHolidays } from './calendar.js';
import { isValidIsBankAccount, isValidKennitala, isValidVskNumber, normalizeKennitala, normalizeVskNumber } from './tax-ids.js';

export { isDeadlines, isHolidays } from './calendar.js';
export {
  isCompanyKennitala,
  isValidIsBankAccount,
  isValidKennitala,
  isValidVskNumber,
  normalizeKennitala,
  normalizeVskNumber,
} from './tax-ids.js';

const VAT: Source = {
  title: 'Skatturinn – Value added tax (rates, registration threshold)',
  url: 'https://www.skatturinn.is/english/companies/value-added-tax/',
};
const INVOICES: Source = {
  title: 'Reglugerð nr. 50/1993 um bókhald og tekjuskráningu virðisaukaskattsskyldra aðila',
  url: 'https://www.reglugerd.is/reglugerdir/allar/nr/50-1993',
};
const BOOKKEEPING: Source = {
  title: 'Lög um bókhald nr. 145/1994, 20. gr. – varðveisla',
  url: 'https://www.althingi.is/lagas/nuna/1994145.html',
};
const B2G: Source = {
  title: 'European Commission – eInvoicing in Iceland (Regulation 44/2019, TS-236)',
  url: 'https://ec.europa.eu/digital-building-blocks/sites/display/DIGITAL/eInvoicing+in+Iceland',
};

/** Iceland. EEA, not EU; VAT (virðisaukaskattur, VSK) under lög nr. 50/1988. */
export const IS: CountryPack = {
  code: 'IS',
  name: 'Iceland',
  region: 'europe',
  euMember: false,
  currency: 'ISK',
  currencyMinorUnits: 0,
  timeZone: 'Atlantic/Reykjavik',
  locales: ['en'],
  taxIds: [
    {
      kind: 'company',
      label: { en: 'Kennitala', is: 'Kennitala' },
      // Íslandsbanki hf., a public company record.
      example: '491008-0160',
      normalize: normalizeKennitala,
      validate: isValidKennitala,
      // Reglugerð 50/1993, 3. gr.: the seller's name and kennitala.
      requiredOnInvoice: true,
      source: INVOICES,
    },
    {
      kind: 'vat',
      label: { en: 'VAT number', is: 'VSK-númer' },
      // Format example only; VSK numbers have no checksum.
      example: '12345',
      normalize: normalizeVskNumber,
      validate: isValidVskNumber,
      // Reglugerð 50/1993, 3. gr.: VAT-registered sellers show their VSK number.
      requiredOnInvoice: true,
      source: INVOICES,
    },
  ],
  indirectTax: {
    kind: 'vat',
    name: { en: 'VAT', is: 'Virðisaukaskattur (VSK)' },
    rateSets: [
      {
        // 25.5% → 24% and 7% → 11% from 1 January 2015 (lög nr. 124/2014).
        validFrom: '2015-01-01',
        rates: [
          { rate: 24, kind: 'standard' },
          { rate: 11, kind: 'reduced', appliesTo: 'food, books, accommodation, hot water and heating, radio licences' },
          { rate: 0, kind: 'zero', appliesTo: 'exports and international transport' },
        ],
      },
    ],
    // Lög 50/1988, 4. gr.: no registration while turnover stays under ISK 2,000,000 in 12 months.
    registrationThreshold: { amount: 2000000, currency: 'ISK' },
    source: VAT,
  },
  invoice: {
    requirements: [
      { field: 'invoice_number', rule: 'Reglugerð 50/1993, 3. gr. – pre-numbered, unbroken series' },
      { field: 'issue_date', rule: 'Reglugerð 50/1993, 3. gr.' },
      { field: 'supplier_name', rule: 'Reglugerð 50/1993, 3. gr.' },
      { field: 'supplier_address', rule: 'Reglugerð 50/1993, 3. gr.' },
      { field: 'supplier_company_id', rule: 'Reglugerð 50/1993, 3. gr. – kennitala' },
      { field: 'supplier_vat_id', when: 'tax_registered', rule: 'Reglugerð 50/1993, 3. gr. – VSK number' },
      { field: 'customer_name', rule: 'Reglugerð 50/1993, 3. gr.' },
      { field: 'customer_vat_id', when: 'b2b', rule: 'Reglugerð 50/1993, 3. gr. – buyer’s kennitala' },
      { field: 'line_description', rule: 'Reglugerð 50/1993, 3. gr.' },
      { field: 'line_quantity', rule: 'Reglugerð 50/1993, 3. gr.' },
      { field: 'line_unit_price', rule: 'Reglugerð 50/1993, 3. gr.' },
      { field: 'supply_date', rule: 'Reglugerð 50/1993, 3. gr.' },
      { field: 'tax_rate_per_line', when: 'tax_registered', rule: 'Reglugerð 50/1993, 3. gr.' },
      { field: 'tax_amount_per_rate', when: 'tax_registered', rule: 'Reglugerð 50/1993, 3. gr.' },
      { field: 'total_with_tax', rule: 'Reglugerð 50/1993, 3. gr.' },
      { field: 'tax_in_local_currency', when: 'tax_registered', rule: 'Lög 50/1988 – VAT in ISK' },
    ],
    numbering: { gapless: true, multipleSeries: true },
    homeCurrencyTaxRequired: true,
    // Lög um bókhald 145/1994, 20. gr.: accounting records kept 7 years.
    retentionYears: 7,
    source: INVOICES,
  },
  einvoicing: [
    {
      scope: 'b2g',
      model: 'peppol_exchange',
      from: '2020-01-01',
      appliesTo: 'public bodies accept only e-invoices from suppliers',
      formats: ['peppol_bis', 'ts_236'],
      platform: 'Peppol',
      source: B2G,
    },
  ],
  payments: {
    iban: false,
    validateDomesticAccount: isValidIsBankAccount,
    reference: 'free_text',
    localMethods: ['bank_transfer', 'krafa', 'card'],
  },
  registry: {
    name: 'Skatturinn – Fyrirtækjaskrá',
    url: 'https://www.skatturinn.is/fyrirtaekjaskra/',
  },
  holidays: isHolidays,
  deadlines: isDeadlines,
  supportLevel: 'pack',
  verifiedAt: '2026-10-28',
  caveats: [
    'The exact paragraph numbers of Reglugerð 50/1993 (invoice content) and lög 50/1988 (registration, deadlines) were not checked against the consolidated text; an Icelandic accountant should confirm the list.',
    'The buyer’s kennitala is stored as customer_vat_id because the contract has no customer company ID field.',
    'Iceland has no B2B e-invoicing mandate; B2G e-invoicing applies since 2020 under Regulation 44/2019.',
    'Bank claims (krafa / greiðsluseðill via the online bank) are the usual way to get paid; Billanta cannot create them without a bank integration, and the contract has no reference type for them.',
    'VSK validation is format-only (5–6 digits). Kennitala checks the date part loosely (no per-month day check).',
    'Only the standard two-month VAT period is modelled; annual filers (small turnover) and primary industries differ. Income-tax return dates are set every year by Skatturinn and are not modelled.',
    'Christmas Eve and New Year’s Eve are half-day holidays; they are listed as full days.',
    'No Icelandic (is) UI locale exists in the app; ISK has no minor unit on invoices.',
    'No free public company registry API is known; lookup is web-only.',
  ],
  sources: [
    VAT,
    INVOICES,
    BOOKKEEPING,
    B2G,
    { title: 'Stjórnarráð Íslands – Almennir frídagar', url: 'https://www.stjornarradid.is/verkefni/vinnumarkadur/almennir-fridagar/' },
  ],
};
