import type { CountryPack, CountryTaxDeadline, Source } from '../types.js';
import { addDays, easter, mondayised, nextBusinessDay, nthWeekday, sortedUnique, utc, withSubstitutes, ymd } from '../au/calendar.js';
import { isValidIrd, isValidNzbn, isValidNzBankAccount, normalizeIrd, normalizeNzbn } from './ids.js';

const IRD_TSI: Source = {
  title: 'Inland Revenue – Taxable supply information',
  url: 'https://www.ird.govt.nz/gst/tax-invoices-for-gst',
};
const IRD_GST_REGISTRATION: Source = { title: 'Inland Revenue – Registering for GST', url: 'https://www.ird.govt.nz/gst/registering-for-gst' };
const IRD_GST_DUE_DATES: Source = {
  title: 'Inland Revenue – GST due dates',
  url: 'https://www.ird.govt.nz/gst/filing-and-paying-gst-and-refunds',
};
const MBIE_EINVOICING: Source = {
  title: 'MBIE – E-invoicing (New Zealand Peppol Authority)',
  url: 'https://www.mbie.govt.nz/business-and-employment/business/support-for-business/e-invoicing',
};
const NZBN: Source = { title: 'New Zealand Business Number', url: 'https://www.nzbn.govt.nz/' };
const EMPLOYMENT_NZ_HOLIDAYS: Source = {
  title: 'Employment New Zealand – Public holidays and anniversary dates',
  url: 'https://www.employment.govt.nz/leave-and-holidays/public-holidays/public-holidays-and-anniversary-dates',
};

/** Te Kāhui o Matariki Public Holiday Act 2022, Schedule 1 (always a Friday). */
const MATARIKI: Readonly<Record<number, string>> = {
  2022: '06-24', 2023: '07-14', 2024: '06-28', 2025: '06-20', 2026: '07-10', 2027: '06-25',
  2028: '07-14', 2029: '07-06', 2030: '06-21', 2031: '07-11', 2032: '07-02', 2033: '06-24',
  2034: '07-07', 2035: '06-29', 2036: '07-18', 2037: '07-10', 2038: '06-25', 2039: '07-15',
  2040: '07-06', 2041: '07-19', 2042: '07-11', 2043: '07-03', 2044: '06-24', 2045: '07-07',
  2046: '06-29', 2047: '07-19', 2048: '07-03', 2049: '06-25', 2050: '07-15', 2051: '06-30',
  2052: '06-21',
};

/**
 * National public holidays (Holidays Act 2003, s 44). Waitangi Day and Anzac
 * Day are "Mondayised" since 2014; Christmas, Boxing Day and 1–2 January get
 * substitutes. Both the day itself and the substitute are listed, so working
 * day checks are right either way. Regional anniversary days are left out.
 */
export function nzHolidays(year: number): string[] {
  const e = easter(year);
  const matariki = MATARIKI[year];
  return sortedUnique([
    ...withSubstitutes([utc(year, 1, 1), utc(year, 1, 2)]),
    ...mondayised(utc(year, 2, 6)),
    addDays(e, -2),
    addDays(e, 1),
    ...mondayised(utc(year, 4, 25)),
    nthWeekday(year, 6, 1, 1),
    ...(matariki ? [new Date(`${year}-${matariki}T00:00:00Z`)] : []),
    nthWeekday(year, 10, 1, 4),
    ...withSubstitutes([utc(year, 12, 25), utc(year, 12, 26)]),
  ]);
}

/**
 * GST return and payment due dates in a calendar year, for monthly filers
 * (two- and six-monthly filers use the same dates for the months their periods
 * end in). The 28th of the month after the period, except a period ending in
 * November (15 January) and in March (7 May); a weekend or holiday moves it to
 * the next working day (Tax Administration Act 1994, s 3 "working day";
 * Goods and Services Tax Act 1985, s 16).
 */
export function nzDeadlines(year: number): CountryTaxDeadline[] {
  const holidays = new Set([...nzHolidays(year), ...nzHolidays(year + 1)]);
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const out: CountryTaxDeadline[] = [];
  // Period ends from November of the previous year to October of this one fall due in `year`.
  for (let i = -2; i < 10; i++) {
    const periodYear = i < 0 ? year - 1 : year;
    const periodMonth = ((i + 12) % 12) + 1;
    const raw = periodMonth === 11 ? utc(periodYear + 1, 1, 15) : periodMonth === 3 ? utc(year, 5, 7) : utc(periodYear, periodMonth + 1, 28);
    out.push({
      date: ymd(nextBusinessDay(raw, holidays)),
      kind: 'gst_return',
      title: { en: `GST return and payment for the period ending ${months[periodMonth - 1]} ${periodYear}` },
      appliesTo: 'GST-registered businesses whose taxable period ends that month',
    });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

export const NZ: CountryPack = {
  code: 'NZ',
  name: 'New Zealand',
  region: 'apac',
  euMember: false,
  currency: 'NZD',
  currencyMinorUnits: 2,
  // Cash is rounded to 10 cents (5 cent coins withdrawn in 2006); electronic payments stay exact.
  cashRounding: 0.1,
  timeZone: 'Pacific/Auckland',
  locales: ['en-NZ', 'en'],
  taxIds: [
    {
      kind: 'vat',
      label: { en: 'GST number', mi: 'Nama GST' },
      // The example from Inland Revenue's RWT/NRWT specification.
      example: '49-091-850',
      normalize: normalizeIrd,
      validate: isValidIrd,
      // GST Act 1985 s 19F: the supplier's GST registration number on taxable supply information over NZD 200.
      requiredOnInvoice: true,
      source: IRD_TSI,
    },
    {
      kind: 'company',
      label: { en: 'NZBN' },
      // A synthetic number with a valid GS1 check digit, not a real business.
      example: '9429041234563',
      normalize: normalizeNzbn,
      validate: isValidNzbn,
      requiredOnInvoice: false,
      source: NZBN,
    },
  ],
  indirectTax: {
    kind: 'gst',
    name: { en: 'GST', mi: 'Tāke Hokohoko' },
    // GST Act 1985 s 8: 10 % from 1 October 1986, 12.5 % from 1 July 1989, 15 % from 1 October 2010.
    rateSets: [
      { validFrom: '1986-10-01', rates: [{ rate: 10, kind: 'standard' }, { rate: 0, kind: 'zero', appliesTo: 'exports, going concerns, land between registered persons' }] },
      { validFrom: '1989-07-01', rates: [{ rate: 12.5, kind: 'standard' }, { rate: 0, kind: 'zero', appliesTo: 'exports, going concerns, land between registered persons' }] },
      { validFrom: '2010-10-01', rates: [{ rate: 15, kind: 'standard' }, { rate: 0, kind: 'zero', appliesTo: 'exports, going concerns, land between registered persons' }] },
    ],
    // GST Act 1985 s 51: registration required above NZD 60,000 in 12 months.
    registrationThreshold: { amount: 60_000, currency: 'NZD' },
    reverseChargeNote: {
      crossBorder: { en: 'Imported services: a registered recipient making less than 95 % taxable supplies accounts for GST under the reverse charge (GST Act 1985 s 8(4B)).' },
    },
    source: IRD_GST_REGISTRATION,
  },
  invoice: {
    // Since 1 April 2023 "taxable supply information" replaced tax invoices; no title is prescribed. `title` stays unset.
    requirements: [
      { field: 'supplier_name', rule: 'GST Act 1985 s 19F' },
      { field: 'issue_date', rule: 'GST Act 1985 s 19F' },
      { field: 'line_description', rule: 'GST Act 1985 s 19F' },
      { field: 'total_with_tax', rule: 'GST Act 1985 s 19F' },
      { field: 'supplier_vat_id', when: 'tax_registered', rule: 'GST Act 1985 s 19F – over NZD 200' },
      { field: 'tax_amount_per_rate', when: 'tax_registered', rule: 'GST Act 1985 s 19F – GST amount or a statement that the price includes GST, over NZD 200' },
      { field: 'customer_name', when: 'above_simplified_threshold', rule: 'GST Act 1985 s 19F – over NZD 1,000: name plus one identifier (address, phone, email, NZBN…)' },
      { field: 'customer_address', when: 'above_simplified_threshold', rule: 'GST Act 1985 s 19F – one identifier besides the name' },
    ],
    simplifiedThreshold: { amount: 1_000, currency: 'NZD' },
    numbering: { gapless: false, multipleSeries: true },
    homeCurrencyTaxRequired: false,
    // Tax Administration Act 1994 s 22: seven years.
    retentionYears: 7,
    source: IRD_TSI,
  },
  einvoicing: [
    {
      scope: 'b2g',
      model: 'peppol_exchange',
      from: '2026-01-01',
      appliesTo: 'Government agencies with more than 2,000 domestic invoices a year must send and receive Peppol e-invoices (Government Procurement Rules, rule 44)',
      formats: ['peppol_pint_anz'],
      platform: 'Peppol',
      source: MBIE_EINVOICING,
    },
    {
      scope: 'b2g',
      model: 'peppol_exchange',
      from: '2027-01-01',
      appliesTo: 'Suppliers to in-scope agencies with annual revenue over NZD 33 million in each of the two previous periods',
      formats: ['peppol_pint_anz'],
      platform: 'Peppol',
      source: MBIE_EINVOICING,
    },
  ],
  payments: {
    iban: false,
    validateDomesticAccount: isValidNzBankAccount,
    reference: 'free_text',
    localMethods: ['bank_transfer', 'card'],
  },
  registry: {
    name: 'New Zealand Business Number register / Companies Office',
    url: 'https://www.nzbn.govt.nz/',
    api: {
      url: 'https://api.business.govt.nz/',
      auth: 'api_key',
      notes: 'NZBN API on the MBIE API portal; free subscription key. GST registration status is not public.',
    },
  },
  holidays: nzHolidays,
  deadlines: nzDeadlines,
  supportLevel: 'pack',
  verifiedAt: '2026-10-28',
  caveats: [
    'No document title is required since 1 April 2023; showing "Tax invoice" is still allowed and common. Supplies of NZD 200 or less need no taxable supply information.',
    'The contract has one simplified threshold; NZ has two tiers (NZD 200 and NZD 1,000). The NZD 200 tier is folded into "tax_registered".',
    'Over NZD 1,000 the buyer\'s name plus any one identifier is needed; customer_address stands in for "one of address, phone, email, NZBN, trading name or website".',
    'homeCurrencyTaxRequired is false: no rule found that the GST amount on taxable supply information must be in NZD – needs a NZ accountant to confirm.',
    'Regional anniversary days (Wellington, Auckland, Canterbury…) are not covered.',
    'Matariki dates are fixed by statute only until 2052; later years return no Matariki.',
    'GST deadlines assume calendar-month periods; balance dates other than 31 March shift the 7 May exception.',
    'B2B Peppol is voluntary; not modelled as a mandate. GST registration numbers are not publicly searchable.',
    'Bank account check is format only (Payments NZ bank-specific modulus rules not implemented).',
  ],
  sources: [IRD_TSI, IRD_GST_REGISTRATION, IRD_GST_DUE_DATES, MBIE_EINVOICING, NZBN, EMPLOYMENT_NZ_HOLIDAYS],
};
