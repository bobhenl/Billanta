import { addDays, isWeekend, isoDate, monthlyDueDates, onOrNextWorkingDay, orthodoxEaster, utc } from '../ro/calendar.js';
import type { CountryPack, CountryTaxDeadline, Source } from '../types.js';
import { isValidBgVatId, isValidEik, normalizeBgVatId, normalizeEik } from './tax-ids.js';

const ZDDS: Source = {
  title: 'Закон за данък върху добавената стойност (ЗДДС)',
  url: 'https://nra.bg/wps/portal/nra/zakonodatelstvo/zakoni/zakon-za-danak-varhu-dobavenata-stoynost',
};
const PWC_BG: Source = {
  title: 'PwC Worldwide Tax Summaries – Bulgaria, other taxes (VAT 20 % / 9 %, EUR 51,130 threshold from 2026)',
  url: 'https://taxsummaries.pwc.com/bulgaria/corporate/other-taxes',
};
const EURO_LAW: Source = {
  title: 'Закон за въвеждане на еврото в Република България (euro from 1 January 2026, BGN 1.95583 = EUR 1)',
  url: 'https://www.minfin.bg/bg/1546',
};
const KT: Source = {
  title: 'Кодекс на труда, чл. 154 (официални празници)',
  url: 'https://lex.bg/laws/ldoc/1594373121',
};
const E_INVOICING_DRAFT: Source = {
  title: 'fiscal-requirements.com – Bulgaria proposes VAT and e-invoicing changes from 2027 and 2028',
  url: 'https://www.fiscal-requirements.com/news/6071-bulgaria-proposes-vat-and-e-invoicing-changes-from-2027-and-2028',
};

/**
 * Кодекс на труда чл. 154: the fixed holidays plus Orthodox Good Friday to
 * Easter Monday. Under ал. 2, a fixed holiday that falls on a Saturday or
 * Sunday gives the next working day off; Easter days are excluded from that.
 * The substitute days are listed too, since they are rest days for deadlines.
 */
export function bulgarianHolidays(year: number): string[] {
  const easter = orthodoxEaster(year);
  const easterDays = [-2, -1, 0, 1].map((n) => isoDate(addDays(easter, n)));
  const fixed = [
    utc(year, 1, 1),
    utc(year, 3, 3),
    utc(year, 5, 1),
    utc(year, 5, 6),
    utc(year, 5, 24),
    utc(year, 9, 6),
    utc(year, 9, 22),
    utc(year, 12, 24),
    utc(year, 12, 25),
    utc(year, 12, 26),
  ];
  const days = new Set([...easterDays, ...fixed.map(isoDate)]);
  for (const d of fixed) {
    if (!isWeekend(d)) continue;
    let sub = addDays(d, 1);
    while (isWeekend(sub) || days.has(isoDate(sub))) sub = addDays(sub, 1);
    // A substitute for 26 December can fall into January; it then belongs to the next year.
    if (sub.getUTCFullYear() === year) days.add(isoDate(sub));
  }
  return [...days].sort();
}

/** Main НАП deadlines; a deadline on a rest day moves to the next working day (ДОПК чл. 4, ал. 2 – verify). */
function bulgarianDeadlines(year: number): CountryTaxDeadline[] {
  const out: CountryTaxDeadline[] = [];
  // ЗДДС чл. 125, ал. 5: the справка-декларация and the VIES declaration by the 14th of the following month.
  for (const d of monthlyDueDates(year, 14, bulgarianHolidays)) {
    out.push({
      date: isoDate(d),
      kind: 'vat_return',
      title: { bg: 'Справка-декларация по ЗДДС', en: 'VAT return' },
      appliesTo: 'VAT-registered persons (monthly tax period)',
    });
    out.push({
      date: isoDate(d),
      kind: 'eu_sales_list',
      title: { bg: 'VIES декларация', en: 'EU recapitulative statement (VIES)' },
      appliesTo: 'months with intra-EU supplies',
    });
  }
  const rest = new Set(bulgarianHolidays(year));
  out.push({
    // ЗКПО чл. 92, ал. 1.
    date: isoDate(onOrNextWorkingDay(utc(year, 3, 31), rest)),
    kind: 'corporate_tax_return',
    title: { bg: 'Годишна данъчна декларация по ЗКПО', en: 'Annual corporate income tax return' },
    appliesTo: 'companies',
  });
  out.push({
    // ЗДДФЛ чл. 53, ал. 1.
    date: isoDate(onOrNextWorkingDay(utc(year, 4, 30), rest)),
    kind: 'income_tax_return',
    title: { bg: 'Годишна данъчна декларация по чл. 50 ЗДДФЛ', en: 'Annual personal income tax return' },
    appliesTo: 'individuals and sole traders',
  });
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

export const BG: CountryPack = {
  code: 'BG',
  name: 'Bulgaria',
  region: 'eu',
  euMember: true,
  // The lev was replaced by the euro on 1 January 2026; see caveats for invoices before that date.
  currency: 'EUR',
  currencyMinorUnits: 2,
  timeZone: 'Europe/Sofia',
  locales: ['bg', 'en'],
  taxIds: [
    {
      kind: 'company',
      label: { bg: 'ЕИК / БУЛСТАТ', en: 'UIC (ЕИК / BULSTAT)' },
      example: '123456786',
      normalize: normalizeEik,
      validate: isValidEik,
      // ЗДДС чл. 114, ал. 1, т. 4 – identification number of the supplier.
      requiredOnInvoice: true,
      source: ZDDS,
    },
    {
      kind: 'vat',
      label: { bg: 'ИН по ДДС', en: 'VAT ID' },
      example: 'BG123456786',
      normalize: normalizeBgVatId,
      validate: isValidBgVatId,
      requiredOnInvoice: true,
      source: ZDDS,
    },
  ],
  indirectTax: {
    kind: 'vat',
    name: { bg: 'ДДС', en: 'VAT' },
    // ЗДДС чл. 66.
    rateSets: [
      {
        validFrom: '2011-04-01',
        rates: [
          { rate: 20, kind: 'standard' },
          { rate: 9, kind: 'reduced', appliesTo: 'hotel accommodation' },
        ],
      },
      {
        // COVID measures: 9 % extended to restaurants, books, baby food, sports facilities.
        validFrom: '2020-07-01',
        rates: [
          { rate: 20, kind: 'standard' },
          { rate: 9, kind: 'reduced', appliesTo: 'accommodation, restaurant and catering, books, baby food and hygiene, sports facilities' },
        ],
      },
      {
        // Restaurant and catering back to 20 % from 1 Jan 2025; the rest of the 9 % list made permanent.
        validFrom: '2025-01-01',
        rates: [
          { rate: 20, kind: 'standard' },
          { rate: 9, kind: 'reduced', appliesTo: 'accommodation, books and periodicals, baby food and baby hygiene products' },
        ],
      },
    ],
    // ЗДДС чл. 96, ал. 1: EUR 51,130 calendar-year turnover from 2026 (was BGN 100,000 over 12 months).
    smallBusiness: {
      threshold: 51_130,
      currency: 'EUR',
      // ЗДДС чл. 113, ал. 9: an unregistered supplier states why no VAT is charged.
      invoiceNote: {
        bg: 'Основание за неначисляване на ДДС: чл. 113, ал. 9 от ЗДДС',
        en: 'No VAT charged: supplier not registered under the Bulgarian VAT Act (art. 113(9) ZDDS)',
      },
      source: PWC_BG,
    },
    reverseChargeNote: {
      // ЗДДС чл. 163а (domestic) and чл. 82, ал. 2 with чл. 114, ал. 1, т. 12.
      domestic: { bg: 'Обратно начисляване – чл. 163а от ЗДДС', en: 'Reverse charge – art. 163a ZDDS' },
      crossBorder: {
        bg: 'Обратно начисляване – чл. 196 от Директива 2006/112/ЕО',
        en: 'Reverse charge – Article 196 of Directive 2006/112/EC',
      },
    },
    source: ZDDS,
  },
  invoice: {
    // ЗДДС чл. 114, ал. 1.
    title: { standard: { bg: 'Фактура', en: 'Invoice' } },
    requirements: [
      { field: 'document_title', rule: 'чл. 114, ал. 1, т. 1 ЗДДС – „Фактура“' },
      { field: 'invoice_number', rule: 'чл. 114, ал. 1, т. 2 ЗДДС – 10 digits, sequential' },
      { field: 'issue_date', rule: 'чл. 114, ал. 1, т. 3' },
      { field: 'supplier_name', rule: 'чл. 114, ал. 1, т. 4' },
      { field: 'supplier_address', rule: 'чл. 114, ал. 1, т. 4' },
      { field: 'supplier_company_id', rule: 'чл. 114, ал. 1, т. 4 – ЕИК' },
      { field: 'supplier_vat_id', when: 'tax_registered', rule: 'чл. 114, ал. 1, т. 4' },
      { field: 'customer_name', rule: 'чл. 114, ал. 1, т. 5' },
      { field: 'customer_address', rule: 'чл. 114, ал. 1, т. 5' },
      { field: 'customer_vat_id', when: 'b2b', rule: 'чл. 114, ал. 1, т. 5' },
      { field: 'line_description', rule: 'чл. 114, ал. 1, т. 6' },
      { field: 'line_quantity', rule: 'чл. 114, ал. 1, т. 6' },
      { field: 'supply_date', rule: 'чл. 114, ал. 1, т. 7 – when it differs from the issue date' },
      { field: 'line_unit_price', rule: 'чл. 114, ал. 1, т. 8' },
      { field: 'tax_rate_per_line', rule: 'чл. 114, ал. 1, т. 10' },
      { field: 'tax_amount_per_rate', rule: 'чл. 114, ал. 1, т. 11' },
      { field: 'tax_in_local_currency', rule: 'чл. 114, ал. 4 – VAT in the national currency (EUR since 2026)' },
      { field: 'total_with_tax' },
    ],
    // ППЗДДС чл. 78: one continuous 10-digit sequence; ranges may be split between locations.
    numbering: { gapless: true, multipleSeries: false, seriesRegistration: false },
    language: { required: ['bg'], note: 'Invoices are drawn up in Bulgarian; names and addresses may be in Latin script.' },
    homeCurrencyTaxRequired: true,
    // Закон за счетоводството чл. 12.
    retentionYears: 10,
    source: ZDDS,
  },
  einvoicing: [
    {
      // Закон за обществените поръчки: contracting authorities accept EN 16931 e-invoices since 18 Apr 2019.
      scope: 'b2g',
      model: 'post_audit',
      from: '2019-04-18',
      appliesTo: 'public buyers must accept EN 16931 e-invoices; suppliers may still send other invoices',
      formats: ['ubl', 'cii'],
      source: E_INVOICING_DRAFT,
    },
  ],
  payments: {
    iban: true,
    qr: ['epc'],
    reference: 'free_text',
    localMethods: ['sepa', 'card', 'cash_on_delivery', 'epay'],
  },
  registry: {
    name: 'Търговски регистър и регистър на ЮЛНЦ (Агенция по вписванията)',
    url: 'https://portal.registryagency.bg',
  },
  holidays: bulgarianHolidays,
  deadlines: bulgarianDeadlines,
  supportLevel: 'pack',
  verifiedAt: '2026-10-21',
  caveats: [
    'Euro changeover: invoices for supplies up to 31 Dec 2025 were in BGN; the pack models only EUR. Corrections and credit notes for 2025 supplies, and the dual price display period (to 8 Aug 2026), follow the transition rules of the euro law – the contract has no currency history field.',
    'Planned e-invoicing: a draft amendment of ЗДДС (consultation until 23 Oct 2026, not enacted) would make structured B2B and B2G e-invoicing mandatory from 1 Jan 2028 with a clearance code from НАП. It is not in `einvoicing` because the contract cannot mark a mandate as draft.',
    'The B2G entry rests on secondary sources; the exact article of the Public Procurement Act was not confirmed.',
    'Rate-set history before 2025 is simplified (exact 9 % scope per period, the 2021–2024 extensions and end dates for restaurants and bread/flour are not modelled).',
    'The 10-year retention (Закон за счетоводството чл. 12) and the language rule need confirmation from a Bulgarian accountant.',
    'Registration threshold: EUR 51,130 per calendar year and registration within 7 days of exceeding it are from secondary sources (PwC); check the current ЗДДС чл. 96.',
    'Deadline shift to the next working day and the cited ДОПК article were not confirmed. Substitute rest days moved by Council of Ministers decision (bridge days) are not modelled.',
    'EPC QR support in Bulgarian banking apps after the euro switch is unconfirmed.',
    'The registry has open data but no public lookup API was confirmed.',
  ],
  sources: [ZDDS, PWC_BG, EURO_LAW, KT, E_INVOICING_DRAFT],
};
