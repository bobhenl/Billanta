import type { CountryPack, CountryTaxDeadline, Source, Subdivision } from '../types.js';
import { addDays, easter, mondayised, nextBusinessDay, nthWeekday, sortedUnique, utc, withSubstitutes, ymd } from './calendar.js';
import { isValidAbn, isValidAcn, isValidBsbAccount, normalizeAbn, normalizeAcn } from './ids.js';

const ATO_TAX_INVOICES: Source = {
  title: 'ATO – Tax invoices',
  url: 'https://www.ato.gov.au/businesses-and-organisations/gst-excise-and-indirect-taxes/gst/tax-invoices',
};
const ATO_GST_REGISTRATION: Source = {
  title: 'ATO – Registering for GST',
  url: 'https://www.ato.gov.au/businesses-and-organisations/gst-excise-and-indirect-taxes/gst/registering-for-gst',
};
const ATO_BAS_DUE_DATES: Source = {
  title: 'ATO – Due dates for lodging and paying your BAS',
  url: 'https://www.ato.gov.au/businesses-and-organisations/preparing-lodging-and-paying/business-activity-statements-bas/due-dates-for-lodging-and-paying-your-bas',
};
const ABR: Source = { title: 'Australian Business Register – ABN Lookup', url: 'https://abr.business.gov.au/' };
const EINVOICING_AU: Source = { title: 'ATO – E-invoicing (Peppol Authority for Australia)', url: 'https://www.ato.gov.au/businesses-and-organisations/einvoicing' };
const FAIR_WORK_HOLIDAYS: Source = { title: 'Fair Work Ombudsman – Public holidays', url: 'https://www.fairwork.gov.au/employment-conditions/public-holidays' };

export const AU_STATES: readonly Subdivision[] = [
  { code: 'AU-ACT', name: 'Australian Capital Territory' },
  { code: 'AU-NSW', name: 'New South Wales' },
  { code: 'AU-NT', name: 'Northern Territory' },
  { code: 'AU-QLD', name: 'Queensland' },
  { code: 'AU-SA', name: 'South Australia' },
  { code: 'AU-TAS', name: 'Tasmania' },
  { code: 'AU-VIC', name: 'Victoria' },
  { code: 'AU-WA', name: 'Western Australia' },
];

/**
 * Holidays every state and territory observes. New Year's Day and Australia
 * Day move to the Monday when they fall on a weekend, Christmas and Boxing
 * Day get substitutes; Anzac Day does not move nationally (WA and ACT do give
 * a Monday, see `auStateHolidays`). Each state sets its own list by statute.
 */
export function auHolidays(year: number): string[] {
  const e = easter(year);
  const newYear = utc(year, 1, 1);
  const australiaDay = utc(year, 1, 26);
  return sortedUnique([
    ...withSubstitutes([newYear]),
    ...mondayised(australiaDay),
    addDays(e, -2),
    addDays(e, 1),
    utc(year, 4, 25),
    ...withSubstitutes([utc(year, 12, 25), utc(year, 12, 26)]),
  ]);
}

/**
 * National holidays plus Labour Day and the King's Birthday, the two that
 * every state has on a different date. Other state days (Easter Saturday,
 * Melbourne Cup, Royal Queensland Show, Western Australia Day…) are left out;
 * see the caveats.
 */
export function auStateHolidays(year: number, state: string): string[] {
  const s = state.toUpperCase().replace(/^AU-/, '');
  const extra: Date[] = [];
  // Labour Day / Eight Hours Day / May Day.
  if (s === 'WA') extra.push(nthWeekday(year, 3, 1, 1));
  else if (s === 'VIC' || s === 'TAS') extra.push(nthWeekday(year, 3, 1, 2));
  else if (s === 'QLD' || s === 'NT') extra.push(nthWeekday(year, 5, 1, 1));
  else if (s === 'NSW' || s === 'ACT' || s === 'SA') extra.push(nthWeekday(year, 10, 1, 1));
  // King's Birthday: QLD first Monday of October, WA by proclamation (usually the last Monday of September).
  if (s === 'QLD') extra.push(nthWeekday(year, 10, 1, 1));
  else if (s === 'WA') extra.push(nthWeekday(year, 9, 1, -1));
  else if (AU_STATES.some((x) => x.code === `AU-${s}`)) extra.push(nthWeekday(year, 6, 1, 2));
  if (s === 'WA' || s === 'ACT') extra.push(...mondayised(utc(year, 4, 25)));
  return [...new Set([...auHolidays(year), ...extra.map(ymd)])].sort();
}

/**
 * BAS deadlines in a calendar year. Quarterly: 28 October, 28 February
 * (the December quarter gets the extra month), 28 April and 28 July. Monthly:
 * the 21st of the following month. A due date on a weekend or national
 * holiday moves to the next business day (ATO due dates page).
 */
export function auDeadlines(year: number): CountryTaxDeadline[] {
  const holidays = new Set([...auHolidays(year), ...auHolidays(year + 1)]);
  const due = (m: number, d: number) => ymd(nextBusinessDay(utc(year, m, d), holidays));
  const quarterly: CountryTaxDeadline[] = [
    [2, 'October–December'],
    [4, 'January–March'],
    [7, 'April–June'],
    [10, 'July–September'],
  ].map(([m, q]) => ({
    date: due(m as number, 28),
    kind: 'gst_bas_quarterly',
    title: { en: `Quarterly BAS and GST payment (${q})` },
    appliesTo: 'quarterly GST reporters',
  }));
  const monthly: CountryTaxDeadline[] = Array.from({ length: 12 }, (_, i) => ({
    date: due(i + 1, 21),
    kind: 'gst_bas_monthly',
    title: { en: 'Monthly BAS and GST payment for the previous month' },
    appliesTo: 'monthly GST reporters (mandatory from AUD 20 million GST turnover)',
  }));
  return [...quarterly, ...monthly].sort((a, b) => a.date.localeCompare(b.date));
}

export const AU: CountryPack = {
  code: 'AU',
  name: 'Australia',
  region: 'apac',
  euMember: false,
  currency: 'AUD',
  currencyMinorUnits: 2,
  // Cash payments round to 5 cents since 1 and 2 cent coins were withdrawn; card and transfer stay exact.
  cashRounding: 0.05,
  timeZone: 'Australia/Sydney',
  locales: ['en-AU', 'en'],
  subdivisions: AU_STATES,
  taxIds: [
    {
      kind: 'company',
      label: { en: 'ABN' },
      // The example ABN the ABR uses in its own format help.
      example: '51 824 753 556',
      normalize: normalizeAbn,
      validate: isValidAbn,
      // A tax invoice must show the supplier's ABN (GST Act s 29-70, GSTR 2013/1).
      requiredOnInvoice: true,
      source: ABR,
    },
    {
      kind: 'other',
      label: { en: 'ACN' },
      // ASIC's published example.
      example: '004 085 616',
      normalize: normalizeAcn,
      validate: isValidAcn,
      // Corporations Act s 153: a company's ACN (or its ABN when that contains the ACN) on public documents.
      requiredOnInvoice: false,
      source: { title: 'ASIC – Australian Company Number', url: 'https://asic.gov.au/' },
    },
  ],
  indirectTax: {
    kind: 'gst',
    name: { en: 'GST' },
    // A New Tax System (Goods and Services Tax) Act 1999, s 9-70; in force since 1 July 2000.
    rateSets: [
      {
        validFrom: '2000-07-01',
        rates: [
          { rate: 10, kind: 'standard' },
          { rate: 0, kind: 'zero', appliesTo: 'GST-free supplies: basic food, health, education, exports' },
        ],
      },
    ],
    // GST Act s 23-15 (AUD 150,000 for non-profit bodies; taxi and ride-sourcing drivers register from the first dollar).
    registrationThreshold: { amount: 75_000, currency: 'AUD' },
    reverseChargeNote: {
      crossBorder: { en: 'Imported services: the GST-registered recipient may have to account for GST under the reverse charge (GST Act Div 84).' },
    },
    source: ATO_GST_REGISTRATION,
  },
  invoice: {
    // GSTR 2013/1: the document must show it is intended to be a tax invoice; "Tax invoice" is the safe title.
    title: { standard: { en: 'Tax invoice' } },
    requirements: [
      { field: 'document_title', when: 'tax_registered', rule: 'GSTR 2013/1 – intended to be a tax invoice' },
      { field: 'supplier_name', rule: 'GST Act s 29-70(1)(c)' },
      { field: 'supplier_company_id', rule: 'GST Act s 29-70 – supplier ABN' },
      { field: 'issue_date', rule: 'GST Act s 29-70' },
      { field: 'line_description', rule: 'GST Act s 29-70 – what is sold, incl. quantity and price' },
      { field: 'line_quantity' },
      { field: 'tax_amount_per_rate', when: 'tax_registered', rule: 'GST payable, or a statement that the total includes GST' },
      { field: 'total_with_tax' },
      { field: 'customer_name', when: 'above_simplified_threshold', rule: 'Buyer identity or ABN from AUD 1,000 incl. GST' },
      { field: 'tax_in_local_currency', when: 'cross_border', rule: 'GST amount in Australian currency' },
    ],
    // Below AUD 1,000 the buyer's identity is not needed; the content is otherwise the same.
    simplifiedThreshold: { amount: 1_000, currency: 'AUD' },
    numbering: { gapless: false, multipleSeries: true },
    homeCurrencyTaxRequired: true,
    // Tax Administration Act 1953 Sch 1 s 382-5: five years.
    retentionYears: 5,
    source: ATO_TAX_INVOICES,
  },
  einvoicing: [
    {
      scope: 'b2g',
      model: 'peppol_exchange',
      from: 'in_force',
      appliesTo: 'Commonwealth non-corporate entities must receive Peppol e-invoices (since 1 July 2022) and be able to send them by end of 2026',
      formats: ['peppol_pint_anz'],
      platform: 'Peppol',
      source: EINVOICING_AU,
    },
  ],
  payments: {
    iban: false,
    validateDomesticAccount: isValidBsbAccount,
    reference: 'free_text',
    localMethods: ['bank_transfer', 'payid', 'bpay', 'card'],
  },
  registry: {
    name: 'ABN Lookup (Australian Business Register)',
    url: 'https://abr.business.gov.au/',
    api: {
      url: 'https://abr.business.gov.au/abrxmlsearch/',
      auth: 'api_key',
      notes: 'Free web services (SOAP/XML and JSON) with a GUID issued on registration; returns entity name, status, GST registration dates.',
    },
  },
  holidays: auHolidays,
  deadlines: auDeadlines,
  supportLevel: 'pack',
  verifiedAt: '2026-10-28',
  caveats: [
    'Holidays are the ones all states share; Labour Day, King\'s Birthday and the Anzac Day Monday are in auStateHolidays. Other state days (Easter Saturday/Sunday, Melbourne Cup, Show days, Western Australia Day, Picnic Day…) are not covered – CountryPack.holidays has no subdivision parameter.',
    'WA King\'s Birthday is set by proclamation each year; the last Monday of September is the usual date, not guaranteed.',
    'The "Business e-Invoicing Right" (B2B Peppol on request) was proposed by Treasury but never enacted; B2B Peppol is voluntary. Not modelled as a mandate.',
    'BSB + account is a format check only – no shared checksum exists. The contract takes one string, so BSB and account are accepted in one field.',
    'Unregistered suppliers must not call the document a tax invoice or charge GST; no wording is mandated, "No GST has been charged" is common practice.',
    'Tax invoices are only required for taxable sales over AUD 82.50 incl. GST when the buyer asks (within 28 days); the rules above apply to every tax invoice Billanta issues.',
    'Monthly BAS 21st and quarterly 28th dates: deferrals for BAS agents and electronic lodgment concessions are not modelled.',
    'Cash rounding to 5 cents applies to cash payments only.',
  ],
  sources: [ATO_TAX_INVOICES, ATO_GST_REGISTRATION, ATO_BAS_DUE_DATES, ABR, EINVOICING_AU, FAIR_WORK_HOLIDAYS],
};
