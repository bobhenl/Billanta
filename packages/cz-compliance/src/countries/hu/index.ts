import { easterSunday } from '../../public-holidays.js';
import { addDays, isoDate, monthlyDueDates, onOrNextWorkingDay, utc } from '../ro/calendar.js';
import type { CountryPack, CountryTaxDeadline, Source } from '../types.js';
import {
  isValidAdoszam,
  isValidCegjegyzekszam,
  isValidHuVatId,
  normalizeAdoszam,
  normalizeCegjegyzekszam,
  normalizeHuVatId,
} from './tax-ids.js';

const AFA_TV: Source = {
  title: '2007. évi CXXVII. törvény az általános forgalmi adóról (Áfa tv.)',
  url: 'https://net.jogtar.hu/jogszabaly?docid=a0700127.tv',
};
const ONLINE_SZAMLA: Source = {
  title: 'NAV Online Számla – documentation and API v3.0',
  url: 'https://onlineszamla.nav.gov.hu',
};
const ALANYI_MENTES: Source = {
  title: 'NAV – Jó hír a kkv-knak: tovább emelkedik az alanyi adómentesség határa (2025. évi LXXXIV. törvény)',
  url: 'https://nav.gov.hu/sajtoszoba/hirek/Jo_hir_a_kkv-knak_tovabb_emelkedik_az_alanyi_adomentesseg_hatara',
};
const MUNKA_TV: Source = {
  title: '2012. évi I. törvény a munka törvénykönyvéről, 102. § (munkaszüneti napok)',
  url: 'https://net.jogtar.hu/jogszabaly?docid=a1200001.tv',
};
const ART: Source = {
  title: '2017. évi CL. törvény az adózás rendjéről (Art.), 1. melléklet – bevallási határidők',
  url: 'https://net.jogtar.hu/jogszabaly?docid=a1700150.tv',
};

/**
 * Munka törvénykönyve 102. § (1). Bridge days that the government moves
 * every year by decree (e.g. 24 December 2026, worked off on 12 December)
 * are rest days, not public holidays, and are not listed.
 */
export function hungarianHolidays(year: number): string[] {
  const e = easterSunday(year);
  const easter = utc(e.getFullYear(), e.getMonth() + 1, e.getDate());
  return [
    utc(year, 1, 1),
    utc(year, 3, 15),
    addDays(easter, -2), // nagypéntek, since 2017
    easter,
    addDays(easter, 1),
    utc(year, 5, 1),
    addDays(easter, 49), // pünkösd
    addDays(easter, 50),
    utc(year, 8, 20),
    utc(year, 10, 23),
    utc(year, 11, 1),
    utc(year, 12, 25),
    utc(year, 12, 26),
  ]
    .map(isoDate)
    .sort();
}

/** Main NAV deadlines (Art. 1. melléklet); a deadline on a rest day moves to the next working day (Art. 10. § (2) – verify). */
function hungarianDeadlines(year: number): CountryTaxDeadline[] {
  const out: CountryTaxDeadline[] = [];
  for (const d of monthlyDueDates(year, 20, hungarianHolidays)) {
    out.push({
      date: isoDate(d),
      kind: 'vat_return',
      title: { hu: 'Áfabevallás (2665)', en: 'VAT return (2665)' },
      appliesTo: 'monthly filers; quarterly filers only after a quarter',
    });
    out.push({
      date: isoDate(d),
      kind: 'eu_sales_list',
      title: { hu: 'Összesítő nyilatkozat (A60)', en: 'EU recapitulative statement (A60)' },
      appliesTo: 'months with intra-EU supplies',
    });
  }
  for (const d of monthlyDueDates(year, 12, hungarianHolidays)) {
    out.push({
      date: isoDate(d),
      kind: 'kata',
      title: { hu: 'KATA tételes adó', en: 'KATA flat tax payment' },
      appliesTo: 'KATA sole traders',
    });
  }
  const rest = new Set(hungarianHolidays(year));
  out.push({
    date: isoDate(onOrNextWorkingDay(utc(year, 2, 25), rest)),
    kind: 'vat_return_annual',
    title: { hu: 'Éves áfabevallás', en: 'Annual VAT return' },
    appliesTo: 'annual VAT filers',
  });
  out.push({
    date: isoDate(onOrNextWorkingDay(utc(year, 5, 20), rest)),
    kind: 'income_tax_return',
    title: { hu: 'Személyi jövedelemadó-bevallás (SZJA)', en: 'Personal income tax return (SZJA)' },
    appliesTo: 'individuals and sole traders',
  });
  out.push({
    date: isoDate(onOrNextWorkingDay(utc(year, 12, 31), rest)),
    kind: 'small_business_opt_in',
    title: { hu: 'Alanyi adómentesség választása', en: 'Opt into the subjective VAT exemption' },
    appliesTo: 'businesses under the threshold for next year',
  });
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

export const HU: CountryPack = {
  code: 'HU',
  name: 'Hungary',
  region: 'eu',
  euMember: true,
  currency: 'HUF',
  // HUF invoices are shown without decimals in practice; the fillér is not used.
  currencyMinorUnits: 0,
  timeZone: 'Europe/Budapest',
  locales: ['hu', 'en'],
  taxIds: [
    {
      kind: 'tax',
      label: { hu: 'Adószám', en: 'Tax number (adószám)' },
      example: '12345676-2-41',
      normalize: normalizeAdoszam,
      validate: isValidAdoszam,
      requiredOnInvoice: true,
      source: AFA_TV,
    },
    {
      kind: 'vat',
      label: { hu: 'Közösségi adószám', en: 'EU VAT ID' },
      example: 'HU12345676',
      normalize: normalizeHuVatId,
      validate: isValidHuVatId,
      // Áfa tv. 169. § d) db): for intra-EU supplies and services.
      requiredOnInvoice: false,
      source: AFA_TV,
    },
    {
      kind: 'company',
      label: { hu: 'Cégjegyzékszám', en: 'Company register number' },
      example: '01-09-123456',
      normalize: normalizeCegjegyzekszam,
      validate: isValidCegjegyzekszam,
      requiredOnInvoice: false,
      source: { title: 'e-cegjegyzek.hu – Céginformációs Szolgálat', url: 'https://www.e-cegjegyzek.hu' },
    },
  ],
  indirectTax: {
    kind: 'vat',
    name: { hu: 'ÁFA', en: 'VAT' },
    // Áfa tv. 82. § and 3. / 3/A. melléklet.
    rateSets: [
      {
        validFrom: '2012-01-01',
        rates: [
          { rate: 27, kind: 'standard' },
          { rate: 18, kind: 'reduced', appliesTo: 'some dairy and bakery products, hotel accommodation (until 2023)' },
          { rate: 5, kind: 'reduced', appliesTo: 'medicines, books, basic food, restaurant services, new housing, hotel accommodation (since 2024)' },
        ],
      },
    ],
    // Áfa tv. 187–188. §; 20 M HUF from 2026, 22 M in 2027, 24 M in 2028.
    smallBusiness: {
      threshold: 20_000_000,
      currency: 'HUF',
      invoiceNote: { hu: 'Alanyi adómentes', en: 'Subjectively exempt from VAT (alanyi adómentes)' },
      source: ALANYI_MENTES,
    },
    reverseChargeNote: {
      // Áfa tv. 142. § and 169. § n).
      domestic: { hu: 'Fordított adózás', en: 'Reverse charge' },
      crossBorder: {
        hu: 'Fordított adózás – 2006/112/EK irányelv 196. cikk',
        en: 'Reverse charge – Article 196 of Directive 2006/112/EC',
      },
    },
    source: AFA_TV,
  },
  invoice: {
    // Áfa tv. 169. §.
    requirements: [
      { field: 'issue_date', rule: 'Áfa tv. 169. § a)' },
      { field: 'invoice_number', rule: 'Áfa tv. 169. § b)' },
      { field: 'supplier_tax_id', rule: 'Áfa tv. 169. § c) – adószám' },
      { field: 'customer_vat_id', when: 'b2b', rule: 'Áfa tv. 169. § d) – adószám or közösségi adószám' },
      { field: 'supplier_name', rule: 'Áfa tv. 169. § e)' },
      { field: 'supplier_address', rule: 'Áfa tv. 169. § e)' },
      { field: 'customer_name', rule: 'Áfa tv. 169. § e)' },
      { field: 'customer_address', rule: 'Áfa tv. 169. § e)' },
      { field: 'line_description', rule: 'Áfa tv. 169. § f)' },
      { field: 'line_quantity', rule: 'Áfa tv. 169. § f)' },
      { field: 'supply_date', rule: 'Áfa tv. 169. § g) – teljesítés dátuma when it differs from the issue date' },
      { field: 'line_unit_price', rule: 'Áfa tv. 169. § h)' },
      { field: 'tax_rate_per_line', rule: 'Áfa tv. 169. § j)' },
      { field: 'tax_amount_per_rate', rule: 'Áfa tv. 169. § k)' },
      { field: 'tax_in_local_currency', rule: 'Áfa tv. 80. § (2) – VAT also in HUF' },
      { field: 'total_with_tax' },
    ],
    // Áfa tv. 169. § b): one or more series allowed, each sequential.
    numbering: { gapless: true, multipleSeries: true, seriesRegistration: false },
    homeCurrencyTaxRequired: true,
    // 2000. évi C. törvény (Számv. tv.) 169. § – 8 years for supporting accounting documents.
    retentionYears: 8,
    source: AFA_TV,
  },
  einvoicing: [
    {
      // Áfa tv. 10. melléklet and 23/2014. (VI. 30.) NGM rendelet. Software-issued invoices are
      // reported "haladéktalanul", i.e. right after issue; since 2020-07-01 without a value threshold.
      scope: 'b2b',
      model: 'real_time_reporting',
      from: '2020-07-01',
      appliesTo: 'every invoice to a domestic taxable person, also from VAT-exempt suppliers',
      formats: ['nav_osa_3'],
      platform: 'NAV Online Számla',
      source: ONLINE_SZAMLA,
    },
    {
      scope: 'b2c',
      model: 'real_time_reporting',
      from: '2021-01-04',
      appliesTo: 'invoices to private persons and foreign buyers',
      formats: ['nav_osa_3'],
      platform: 'NAV Online Számla',
      source: ONLINE_SZAMLA,
    },
  ],
  payments: {
    iban: true,
    // MNB QR standard for instant transfers (qvik), live since 2024.
    qr: ['mnb_qr'],
    reference: 'free_text',
    localMethods: ['bank_transfer', 'instant_transfer', 'card', 'cash', 'cash_on_delivery'],
  },
  registry: {
    name: 'NAV Online Számla – queryTaxpayer',
    url: 'https://onlineszamla.nav.gov.hu',
    api: {
      url: 'https://api.onlineszamla.nav.gov.hu/invoiceService/v3/queryTaxpayer',
      auth: 'api_key',
      notes: "Needs the customer's NAV technical user (login, password hash, signing key); VIES is the no-auth fallback.",
    },
  },
  holidays: hungarianHolidays,
  deadlines: hungarianDeadlines,
  supportLevel: 'pack',
  verifiedAt: '2026-10-21',
  caveats: [
    'Every invoice must be reported to NAV Online Számla right after issue, in NAV\'s own XML (not UBL); an unreported invoice is a compliance failure for the customer (penalty up to 500,000 HUF per invoice – unconfirmed).',
    'The invoicing software itself must meet 23/2014. NGM rendelet (no deletion, audit trail, data export) and the developer issues a conformity statement; needs a Hungarian tax adviser before launch.',
    'Holidays list only Mt. 102. § days; government bridge days and the Saturdays worked in exchange (e.g. 24 Dec 2026 rest day, 12 Dec 2026 working Saturday) need a per-year decree list that the contract has no field for.',
    'Retention of 8 years follows Számv. tv. 169. §; confirm for sole traders under átalányadó / KATA.',
    'The 18 % / 5 % rate scope is summarised; accommodation moved from 18 % to 5 % in 2024 within the same rate set – check Áfa tv. 3. and 3/A. melléklet for the current lists.',
    'The deadline shift to the next working day and the Art. article number were not confirmed; quarterly VAT filers need only the months after a quarter.',
    'MNB QR (qvik) payload spec not yet checked.',
    'Simplified invoices (Áfa tv. 176. §) have no amount threshold in the law, so simplifiedThreshold is not set.',
  ],
  sources: [AFA_TV, ONLINE_SZAMLA, ALANYI_MENTES, MUNKA_TV, ART],
};
