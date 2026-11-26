import type { CountryPack, CountryTaxDeadline, TaxRateSet } from '../types.js';
import { easterOffset, endOfMonth, nextWorkingDay, ymd } from '../de/dates.js';
import { AT_TAX_IDS } from './tax-ids.js';

const RIS_USTG = 'https://www.ris.bka.gv.at/GeltendeFassung.wxe?Abfrage=Bundesnormen&Gesetzesnummer=10004873';

/**
 * § 7 Abs. 2 Arbeitsruhegesetz / Feiertagsruhegesetz 1957: the 13 statutory
 * holidays on weekdays and Sundays alike (Easter and Whit Sunday are left
 * out because they are always Sundays). Karfreitag has not been a holiday
 * since 2019.
 */
export function austrianHolidays(year: number): string[] {
  return [
    ymd(year, 1, 1),
    ymd(year, 1, 6),
    easterOffset(year, 1),
    ymd(year, 5, 1),
    easterOffset(year, 39),
    easterOffset(year, 50),
    easterOffset(year, 60),
    ymd(year, 8, 15),
    ymd(year, 10, 26),
    ymd(year, 11, 1),
    ymd(year, 12, 8),
    ymd(year, 12, 25),
    ymd(year, 12, 26),
  ].sort();
}

// § 108 Abs. 3 BAO: Saturday, Sunday, a holiday, Karfreitag and 24 December push a deadline to the next working day.
const bao108 = (year: number) => [...austrianHolidays(year), easterOffset(year, -2), ymd(year, 12, 24)];
const due = (iso: string) => nextWorkingDay(iso, bao108);

/**
 * UVA: 15th of the second month after the period (§ 21 Abs. 1 UStG), monthly
 * above EUR 100,000 prior-year turnover, quarterly otherwise. ZM: end of the
 * month after the period (Art. 21 Abs. 3 UStG, Binnenmarktregelung).
 * Income-tax prepayments: 15 Feb/May/Aug/Nov (§ 45 Abs. 2 EStG). Annual
 * returns via FinanzOnline: 30 June (§ 134 Abs. 1 BAO).
 */
export function austrianDeadlines(year: number): CountryTaxDeadline[] {
  const out: CountryTaxDeadline[] = [];
  for (let m = 1; m <= 12; m++) {
    out.push({
      date: due(ymd(year, m, 15)),
      kind: 'vat_return_monthly',
      title: { de: 'Umsatzsteuervoranmeldung (monatlich)', en: 'VAT advance return (monthly)' },
      appliesTo: 'monthly filers (prior-year turnover > EUR 100,000)',
    });
    out.push({
      date: due(endOfMonth(year, m)),
      kind: 'ec_sales_list',
      title: { de: 'Zusammenfassende Meldung', en: 'EC sales list' },
      appliesTo: 'businesses with intra-EU supplies',
    });
  }
  for (const m of [2, 5, 8, 11]) {
    out.push({
      date: due(ymd(year, m, 15)),
      kind: 'vat_return_quarterly',
      title: { de: 'Umsatzsteuervoranmeldung (vierteljährlich)', en: 'VAT advance return (quarterly)' },
      appliesTo: 'quarterly filers (prior-year turnover ≤ EUR 100,000)',
    });
    out.push({
      date: due(ymd(year, m, 15)),
      kind: 'income_tax_prepayment',
      title: { de: 'Einkommensteuer-Vorauszahlung', en: 'Income tax prepayment' },
    });
  }
  out.push({
    date: due(ymd(year, 6, 30)),
    kind: 'annual_returns',
    title: { de: `Steuererklärungen ${year - 1} (FinanzOnline)`, en: `${year - 1} annual tax returns (FinanzOnline)` },
  });
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

const STANDARD_20 = { rate: 20, kind: 'standard', appliesTo: 'most goods and services' } as const;
const REDUCED_13 = { rate: 13, kind: 'reduced', appliesTo: 'cultural events, live animals, plants, domestic flights, some wine sold by the producer' } as const;
const REDUCED_10 = { rate: 10, kind: 'reduced', appliesTo: 'food, books, newspapers, medicines, passenger transport, residential rent, accommodation' } as const;
const PV_ZERO = { rate: 0, kind: 'zero', appliesTo: 'PV modules up to 35 kWp for buildings (§ 28 Abs. 62 UStG)' } as const;

// § 10 UStG 1994. 13 % since the Steuerreform 2015/2016.
const RATE_SETS: readonly TaxRateSet[] = [
  { validFrom: '2016-01-01', rates: [STANDARD_20, REDUCED_13, REDUCED_10] },
  {
    // COVID-19 cut for restaurants, culture and publications (§ 28 Abs. 52 UStG), 1 Jul 2020 – 31 Dec 2021.
    validFrom: '2020-07-01',
    rates: [STANDARD_20, REDUCED_13, REDUCED_10, { rate: 5, kind: 'super_reduced', appliesTo: 'restaurant meals and drinks, culture, publications (temporary)' }],
  },
  { validFrom: '2022-01-01', rates: [STANDARD_20, REDUCED_13, REDUCED_10] },
  { validFrom: '2024-01-01', rates: [STANDARD_20, REDUCED_13, REDUCED_10, PV_ZERO] },
  // The PV zero rate ended for contracts concluded from 1 Apr 2025 (Budgetsanierungsmaßnahmengesetz 2025, Teil I).
  { validFrom: '2025-04-01', rates: [STANDARD_20, REDUCED_13, REDUCED_10] },
  {
    // UStG 1994 as amended in 2026 (paragraph unconfirmed, see caveats): 4.9 % on listed staple foods by CN code from 1 Jul 2026.
    validFrom: '2026-07-01',
    rates: [
      STANDARD_20,
      REDUCED_13,
      REDUCED_10,
      { rate: 4.9, kind: 'super_reduced', appliesTo: 'listed staple foods (milk, butter, eggs, bread, flour, rice, pasta, fruit and vegetables, salt)' },
    ],
  },
];

export const AT: CountryPack = {
  code: 'AT',
  name: 'Austria',
  region: 'eu',
  euMember: true,
  currency: 'EUR',
  currencyMinorUnits: 2,
  timeZone: 'Europe/Vienna',
  locales: ['de-AT', 'de', 'en'],
  taxIds: AT_TAX_IDS,
  indirectTax: {
    kind: 'vat',
    name: { de: 'Umsatzsteuer (USt.)', en: 'VAT (Umsatzsteuer)' },
    rateSets: RATE_SETS,
    // § 6 Abs. 1 Z 27 UStG since 1 Jan 2025: EUR 55,000 gross turnover, with a 10 % tolerance (EUR 60,500) in the current year.
    smallBusiness: {
      threshold: 55_000,
      currency: 'EUR',
      invoiceNote: {
        de: 'Umsatzsteuerfrei aufgrund der Kleinunternehmerregelung gemäß § 6 Abs. 1 Z 27 UStG.',
        en: 'VAT exempt – small business exemption under § 6(1)(27) UStG (Austria).',
      },
      source: { title: 'USP – Kleinunternehmerregelung ab 2025', url: 'https://www.usp.gv.at/aktuelles/newsliste/kleinunternehmerregelung-ab-2025.html' },
    },
    reverseChargeNote: {
      // § 11 Abs. 1a UStG: the invoice must point to the transfer of tax liability and show the recipient's UID.
      domestic: { de: 'Übergang der Steuerschuld auf den Leistungsempfänger (§ 19 Abs. 1a UStG)', en: 'Reverse charge – the recipient is liable for the VAT' },
      crossBorder: { de: 'Übergang der Steuerschuld auf den Leistungsempfänger', en: 'Reverse charge – the recipient is liable for the VAT' },
    },
    source: { title: '§ 10 UStG 1994', url: RIS_USTG },
  },
  invoice: {
    // § 11 Abs. 1 Z 3 UStG 1994; ≤ EUR 400 gross: Kleinbetragsrechnung (§ 11 Abs. 6).
    requirements: [
      { field: 'supplier_name', rule: '§ 11 Abs. 1 Z 3 lit. a UStG' },
      { field: 'supplier_address', rule: '§ 11 Abs. 1 Z 3 lit. a UStG' },
      { field: 'customer_name', rule: '§ 11 Abs. 1 Z 3 lit. b UStG', when: 'above_simplified_threshold' },
      { field: 'customer_address', rule: '§ 11 Abs. 1 Z 3 lit. b UStG', when: 'above_simplified_threshold' },
      { field: 'line_description', rule: '§ 11 Abs. 1 Z 3 lit. c UStG' },
      { field: 'line_quantity', rule: '§ 11 Abs. 1 Z 3 lit. c UStG' },
      { field: 'supply_date', rule: '§ 11 Abs. 1 Z 3 lit. d UStG' },
      { field: 'tax_rate_per_line', rule: '§ 11 Abs. 1 Z 3 lit. f UStG' },
      { field: 'tax_amount_per_rate', rule: '§ 11 Abs. 1 Z 3 lit. e–f UStG', when: 'above_simplified_threshold' },
      { field: 'total_with_tax', rule: '§ 11 Abs. 6 UStG' },
      { field: 'issue_date', rule: '§ 11 Abs. 1 Z 3 lit. g UStG' },
      { field: 'invoice_number', rule: '§ 11 Abs. 1 Z 3 lit. h UStG', when: 'above_simplified_threshold' },
      { field: 'supplier_vat_id', rule: '§ 11 Abs. 1 Z 3 lit. i UStG', when: 'above_simplified_threshold' },
      // Domestic: only above EUR 10,000 gross (§ 11 Abs. 1 Z 3 lit. j); intra-EU and reverse charge: always.
      { field: 'customer_vat_id', rule: '§ 11 Abs. 1 Z 3 lit. j, Abs. 1a UStG', when: 'cross_border' },
    ],
    simplifiedThreshold: { amount: 400, currency: 'EUR' },
    // "Fortlaufende Nummer", one or more series; gaps must be explainable (UStR Rz 1561).
    numbering: { gapless: false, multipleSeries: true },
    // Art. 230 MwStSystRL, § 20 Abs. 6 UStG: tax in EUR when invoicing in another currency.
    homeCurrencyTaxRequired: true,
    // § 132 Abs. 1 BAO (longer for real property).
    retentionYears: 7,
    source: { title: '§ 11 UStG 1994', url: RIS_USTG },
  },
  einvoicing: [
    {
      scope: 'b2g',
      model: 'post_audit',
      from: '2014-01-01',
      appliesTo: 'suppliers to federal contracting authorities',
      formats: ['ebinterface', 'peppol_bis'],
      platform: 'e-Rechnung.gv.at (USP) / Peppol',
      source: { title: 'IKT-Konsolidierungsgesetz § 5; e-Rechnung an den Bund', url: 'https://www.erechnung.gv.at/' },
    },
  ],
  payments: {
    iban: true,
    qr: ['epc'],
    reference: 'free_text',
    localMethods: ['sepa', 'sepa_direct_debit', 'eps', 'card', 'paypal'],
  },
  registry: { name: 'Firmenbuch', url: 'https://www.justiz.gv.at/service/datenbanken/firmenbuch.2e6.de.html' },
  holidays: austrianHolidays,
  deadlines: austrianDeadlines,
  supportLevel: 'pack',
  verifiedAt: '2026-10-21',
  caveats: [
    'Recipient UID on domestic invoices is required only above EUR 10,000 gross (§ 11 Abs. 1 Z 3 lit. j UStG); the contract has no amount-based "when", so only the cross-border case is encoded.',
    'Kleinunternehmer: the EUR 55,000 limit is gross; exceeding it by up to 10 % (EUR 60,500) keeps the exemption for the current year only. The invoice-note wording is customary, not prescribed.',
    'The 4.9 % staple-food rate (from 1 Jul 2026) applies by CN code, not by product name; the exact list must come from the law text before goods are mapped.',
    'PV zero rate: contracts concluded before 7 Mar 2025 and delivered by 31 Dec 2025 kept 0 %; the rate set from 2025-04-01 ignores that transition.',
    'UVA filing can be waived for small quarterly filers who pay on time (§ 21 Abs. 1a UStG); check the current threshold.',
    'Steuernummer and Firmenbuchnummer are checked for format only.',
    'No B2B e-invoice mandate yet; Austria follows ViDA (2030+). Check for an earlier national date each year.',
    'Registrierkassenpflicht (RKSV) is out of scope for transfer-paid invoices but applies to a future POS/cash mode.',
  ],
  sources: [
    { title: 'Umsatzsteuergesetz 1994 (RIS)', url: RIS_USTG },
    { title: 'Bundesabgabenordnung (RIS)', url: 'https://www.ris.bka.gv.at/GeltendeFassung.wxe?Abfrage=Bundesnormen&Gesetzesnummer=10003940' },
    { title: 'USP – Kleinunternehmerregelung ab 2025', url: 'https://www.usp.gv.at/aktuelles/newsliste/kleinunternehmerregelung-ab-2025.html' },
    { title: 'KPMG – Ende des PV-Nullsteuersatzes', url: 'https://kpmg.com/at/de/media/newsletter/tax-news/2025/04/tn-kmu-erste-budgetsanierungsmassnahmen-beschlossen.html' },
    { title: 'ORF – Nationalrat fixiert MwSt.-Senkung auf Grundnahrungsmittel', url: 'https://orf.at/stories/3430951/' },
    { title: 'e-Rechnung an den Bund', url: 'https://www.erechnung.gv.at/' },
  ],
};
