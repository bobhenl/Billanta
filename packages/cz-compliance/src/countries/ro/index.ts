import type { CountryPack, CountryTaxDeadline, Source } from '../types.js';
import { addDays, isoDate, monthlyDueDates, onOrNextWorkingDay, orthodoxEaster, utc } from './calendar.js';
import {
  isValidCui,
  isValidRoVatId,
  isValidTradeRegister,
  normalizeCui,
  normalizeRoVatId,
  normalizeTradeRegister,
} from './tax-ids.js';

const CODUL_FISCAL: Source = {
  title: 'Legea 227/2015 privind Codul fiscal (Titlul VII – TVA)',
  url: 'https://static.anaf.ro/static/10/Anaf/legislatie/Cod_fiscal_norme_2023.htm',
};
const LEGEA_141_2025: Source = {
  title: 'PwC Romania – Law no. 141/2025 on some fiscal-budgetary measures (VAT 21 % / 11 % from 1 Aug 2025)',
  url: 'https://www.pwc.ro/en/tax-legal/alerts/law-no--141-2025-on-some-fiscal-budgetary-measures.html',
};
const E_FACTURA: Source = {
  title: 'ANAF – RO e-Factura',
  url: 'https://www.anaf.ro/anaf/internet/ANAF/despre_anaf/strategii_anaf/proiecte_digitalizare/e.factura',
};
const E_FACTURA_2026: Source = {
  title: 'VATCalc – Romania updates RO e-Factura 2026 (OUG 89/2025: 5 working days, non-residents)',
  url: 'https://vatcalc.com/romania/romania-updates-ro-e-factura-2026',
};
const SME_RULES: Source = {
  title: 'European Commission – SME VAT rules: Romania',
  url: 'https://sme-vat-rules.ec.europa.eu/national-vat-rules/romania-sme-rules_lv',
};
const CODUL_MUNCII: Source = {
  title: 'Legea 53/2003 Codul muncii, art. 139 (zile de sărbătoare legală)',
  url: 'https://legislatie.just.ro/Public/DetaliiDocument/41625',
};
const ANAF_PUBLIC_API: Source = {
  title: 'ANAF – web services (PlatitorTvaRest, public VAT payer lookup)',
  url: 'https://static.anaf.ro/static/10/Anaf/Informatii_R/Servicii_web/doc_WS_V9.txt',
};

/** Codul muncii art. 139 alin. (1), Orthodox Easter and Pentecost (Rusalii) included. */
export function romanianHolidays(year: number): string[] {
  const easter = orthodoxEaster(year);
  const days = [
    utc(year, 1, 1),
    utc(year, 1, 2),
    utc(year, 1, 6), // Bobotează, since 2024 (Legea 17/2023)
    utc(year, 1, 7), // Sf. Ioan Botezătorul, since 2024 (Legea 17/2023)
    utc(year, 1, 24),
    addDays(easter, -2), // Vinerea Mare
    easter,
    addDays(easter, 1),
    utc(year, 5, 1),
    utc(year, 6, 1),
    addDays(easter, 49), // Rusalii
    addDays(easter, 50),
    utc(year, 8, 15),
    utc(year, 11, 30),
    utc(year, 12, 1),
    utc(year, 12, 25),
    utc(year, 12, 26),
  ].filter((d) => year >= 2024 || !(d.getUTCMonth() === 0 && (d.getUTCDate() === 6 || d.getUTCDate() === 7)));
  // Rusalii Monday and 1 June (Ziua Copilului) coincide in some years (2026).
  return [...new Set(days.map(isoDate))].sort();
}

/**
 * Main ANAF deadlines (Codul de procedură fiscală, Legea 207/2015, and the
 * Cod fiscal articles cited). A deadline on a rest day moves to the next
 * working day (Codul de procedură fiscală art. 270 alin. (6) – verify).
 */
function romanianDeadlines(year: number): CountryTaxDeadline[] {
  const out: CountryTaxDeadline[] = [];
  // D300, art. 323 Cod fiscal: 25th of the month after the tax period.
  for (const d of monthlyDueDates(year, 25, romanianHolidays)) {
    out.push({
      date: isoDate(d),
      kind: 'vat_return',
      title: { ro: 'Decont de TVA (D300)', en: 'VAT return (D300)' },
      appliesTo: 'monthly filers; quarterly filers only after a quarter',
    });
    out.push({
      date: isoDate(d),
      kind: 'eu_sales_list',
      title: { ro: 'Declarație recapitulativă (D390)', en: 'EU recapitulative statement (D390)' },
      appliesTo: 'months with intra-EU supplies or acquisitions',
    });
  }
  // D394, art. 326 alin. (8) Cod fiscal: 30th of the month after the period.
  for (const d of monthlyDueDates(year, 30, romanianHolidays)) {
    out.push({
      date: isoDate(d),
      kind: 'domestic_sales_list',
      title: { ro: 'Declarație informativă (D394)', en: 'Domestic supplies statement (D394)' },
      appliesTo: 'VAT-registered persons',
    });
  }
  const rest = new Set(romanianHolidays(year));
  out.push({
    date: isoDate(onOrNextWorkingDay(utc(year, 5, 25), rest)),
    kind: 'income_tax_return',
    title: { ro: 'Declarația unică', en: 'Single return (Declarația unică)' },
    appliesTo: 'individuals and PFA',
  });
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

export const RO: CountryPack = {
  code: 'RO',
  name: 'Romania',
  region: 'eu',
  euMember: true,
  currency: 'RON',
  currencyMinorUnits: 2,
  timeZone: 'Europe/Bucharest',
  locales: ['ro', 'en'],
  taxIds: [
    {
      kind: 'company',
      label: { ro: 'CUI', en: 'CUI (tax identification code)' },
      example: '4221306',
      normalize: normalizeCui,
      validate: isValidCui,
      requiredOnInvoice: true,
      source: CODUL_FISCAL,
    },
    {
      kind: 'vat',
      label: { ro: 'Cod de înregistrare în scopuri de TVA', en: 'VAT ID' },
      example: 'RO4221306',
      normalize: normalizeRoVatId,
      validate: isValidRoVatId,
      requiredOnInvoice: true,
      source: CODUL_FISCAL,
    },
    {
      kind: 'other',
      label: { ro: 'Nr. Registrul Comerțului', en: 'Trade register number' },
      example: 'J40/1234/2020',
      normalize: normalizeTradeRegister,
      validate: isValidTradeRegister,
      // Company-law requirement (Legea 26/1990 art. 74), not art. 319 Cod fiscal.
      requiredOnInvoice: true,
      source: { title: 'ONRC – Oficiul Național al Registrului Comerțului', url: 'https://www.onrc.ro' },
    },
  ],
  indirectTax: {
    kind: 'vat',
    name: { ro: 'TVA', en: 'VAT' },
    // Art. 291 Cod fiscal.
    rateSets: [
      {
        validFrom: '2016-01-01',
        rates: [
          { rate: 20, kind: 'standard' },
          { rate: 9, kind: 'reduced', appliesTo: 'food, non-alcoholic drinks, medicines, water, restaurants, accommodation' },
          { rate: 5, kind: 'reduced', appliesTo: 'books, newspapers, social housing, cultural events' },
        ],
      },
      {
        validFrom: '2017-01-01',
        rates: [
          { rate: 19, kind: 'standard' },
          { rate: 9, kind: 'reduced', appliesTo: 'food, non-alcoholic drinks, medicines, water, restaurants, accommodation' },
          { rate: 5, kind: 'reduced', appliesTo: 'books, newspapers, social housing, cultural events' },
        ],
      },
      {
        // Legea 141/2025: 19 → 21 %, the 9 % and 5 % rates merged into 11 %.
        validFrom: '2025-08-01',
        rates: [
          { rate: 21, kind: 'standard' },
          {
            rate: 11,
            kind: 'reduced',
            appliesTo: 'food and drinks, medicines, water and sewage, books and newspapers, accommodation, restaurants',
          },
        ],
      },
    ],
    // Art. 310 Cod fiscal, threshold raised from 300,000 to 395,000 RON from 1 Sep 2025.
    smallBusiness: {
      threshold: 395_000,
      currency: 'RON',
      invoiceNote: {
        ro: 'Scutit de TVA conform art. 310 din Codul fiscal',
        en: 'VAT exempt under art. 310 of the Romanian Fiscal Code',
      },
      source: SME_RULES,
    },
    reverseChargeNote: {
      // Art. 331 Cod fiscal (domestic reverse charge), art. 319 alin. (20) lit. i).
      domestic: { ro: 'Taxare inversă', en: 'Reverse charge' },
      crossBorder: {
        ro: 'Taxare inversă – art. 196 din Directiva 2006/112/CE',
        en: 'Reverse charge – Article 196 of Directive 2006/112/EC',
      },
    },
    source: LEGEA_141_2025,
  },
  invoice: {
    // Art. 319 alin. (20) Cod fiscal.
    requirements: [
      { field: 'invoice_number', rule: 'art. 319 alin. (20) lit. a) Cod fiscal' },
      { field: 'issue_date', rule: 'art. 319 alin. (20) lit. b)' },
      { field: 'supply_date', rule: 'art. 319 alin. (20) lit. c) – when it differs from the issue date' },
      { field: 'supplier_name', rule: 'art. 319 alin. (20) lit. d)' },
      { field: 'supplier_address', rule: 'art. 319 alin. (20) lit. d)' },
      { field: 'supplier_vat_id', when: 'tax_registered', rule: 'art. 319 alin. (20) lit. d)' },
      { field: 'supplier_company_id', rule: 'art. 319 alin. (20) lit. d) – CUI for non-VAT-registered suppliers' },
      { field: 'customer_name', rule: 'art. 319 alin. (20) lit. f)' },
      { field: 'customer_address', rule: 'art. 319 alin. (20) lit. f)' },
      { field: 'customer_vat_id', when: 'b2b', rule: 'art. 319 alin. (20) lit. f)' },
      { field: 'line_description', rule: 'art. 319 alin. (20) lit. g)' },
      { field: 'line_quantity', rule: 'art. 319 alin. (20) lit. g)' },
      { field: 'line_unit_price', rule: 'art. 319 alin. (20) lit. h)' },
      { field: 'tax_rate_per_line', rule: 'art. 319 alin. (20) lit. h)' },
      { field: 'tax_amount_per_rate', rule: 'art. 319 alin. (20) lit. j)' },
      { field: 'tax_in_local_currency', rule: 'art. 319 alin. (20) lit. j) – VAT in lei' },
      { field: 'total_with_tax' },
    ],
    // Art. 319 alin. (12): simplified invoice up to the RON equivalent of EUR 100 (incl. VAT).
    simplifiedThreshold: { amount: 100, currency: 'EUR' },
    // Art. 319 alin. (20) lit. a): one or more series, sequential numbers; the issuer sets the series itself.
    numbering: { gapless: true, multipleSeries: true, seriesRegistration: false },
    // Legea contabilității 82/1991 art. 6: accounting documents in Romanian (bilingual allowed).
    language: { required: ['ro'], note: 'Bilingual invoices are fine as long as Romanian is one of the languages.' },
    homeCurrencyTaxRequired: true,
    retentionYears: 10,
    source: CODUL_FISCAL,
  },
  einvoicing: [
    {
      scope: 'b2g',
      model: 'clearance',
      from: 'in_force',
      formats: ['ubl_cius_ro', 'cii'],
      platform: 'RO e-Factura (SPV)',
      source: E_FACTURA,
    },
    {
      // OUG 120/2021 as amended by Legea 296/2023; 5 working days since 1 Jan 2026 (OUG 89/2025).
      scope: 'b2b',
      model: 'clearance',
      from: '2024-01-01',
      appliesTo: 'all Romanian-established taxable persons; since 2026 also supplies to non-resident VAT-registered buyers',
      formats: ['ubl_cius_ro', 'cii'],
      platform: 'RO e-Factura (SPV)',
      source: E_FACTURA_2026,
    },
    {
      // Legea 296/2023: B2C invoices go through e-Factura too (buyer CNP or 13 zeros).
      scope: 'b2c',
      model: 'clearance',
      from: '2025-01-01',
      formats: ['ubl_cius_ro', 'cii'],
      platform: 'RO e-Factura (SPV)',
      source: E_FACTURA_2026,
    },
  ],
  payments: {
    iban: true,
    reference: 'free_text',
    localMethods: ['bank_transfer', 'card', 'cash_on_delivery'],
  },
  registry: {
    name: 'ANAF – registrul contribuabililor / plătitori de TVA',
    url: 'https://www.anaf.ro/RegistruTVA/',
    api: {
      url: 'https://webservicesp.anaf.ro/api/PlatitorTvaRest/v9/tva',
      auth: 'none',
      notes: 'POST up to 100 CUIs per request, about 1 request per second; returns name, address, VAT status and e-Factura registration.',
    },
  },
  holidays: romanianHolidays,
  deadlines: romanianDeadlines,
  supportLevel: 'pack',
  verifiedAt: '2026-10-21',
  caveats: [
    'Legea 141/2025 reduced-rate list (11 %) is summarised; the exact item list, and the transitional 9 % for housing that ended on 31 July 2026, must be checked against art. 291 in its current text.',
    'e-Factura: reports differ on whether OG 6/2026 postponed the obligation for suppliers identified only by CNP (to mid-2026) and which entity types were exempted; confirm with ANAF before onboarding PFA without CUI.',
    'The b2g mandate date is given as in_force; B2G e-Factura was phased in from 2022 and is mandatory for all suppliers now.',
    'The CUI checksum is the widely used ANAF control-key algorithm; the normative act that publishes it was not confirmed.',
    'Trade register numbers: the new ONRC format (letter + year + number + 2 digits, since 2024) is checked by shape only; confirm the exact layout with ONRC.',
    'Retention: 10 years is taken from Legea 82/1991 for accounting records; supporting documents may have a shorter period – confirm with a Romanian accountant.',
    'Deadline shift to the next working day follows the general rule of the fiscal procedure code; the article reference was not confirmed.',
    'Quarterly VAT filers: the D300 dates are listed monthly; the app must pick the months that close a quarter.',
    'No national payment QR standard; EPC QR is not widely read by Romanian banking apps (unconfirmed).',
  ],
  sources: [CODUL_FISCAL, LEGEA_141_2025, E_FACTURA, E_FACTURA_2026, SME_RULES, CODUL_MUNCII, ANAF_PUBLIC_API],
};
