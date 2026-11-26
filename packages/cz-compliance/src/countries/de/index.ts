import type { CountryPack, CountryTaxDeadline, TaxRateSet } from '../types.js';
import { easterOffset, nextWorkingDay, ymd } from './dates.js';
import { DE_TAX_IDS } from './tax-ids.js';

const USTG = 'https://www.gesetze-im-internet.de/ustg_1980/';
const BMF_ERECHNUNG = 'https://www.bundesfinanzministerium.de/Content/DE/FAQ/e-rechnung.html';

/**
 * Nationwide holidays only (Neujahr, Karfreitag, Ostermontag, Tag der Arbeit,
 * Christi Himmelfahrt, Pfingstmontag, Tag der Deutschen Einheit, 1. and 2.
 * Weihnachtstag). Holidays are Länder law; the regional ones are in caveats.
 */
export function germanHolidays(year: number): string[] {
  return [
    ymd(year, 1, 1),
    easterOffset(year, -2),
    easterOffset(year, 1),
    ymd(year, 5, 1),
    easterOffset(year, 39),
    easterOffset(year, 50),
    ymd(year, 10, 3),
    ymd(year, 12, 25),
    ymd(year, 12, 26),
  ].sort();
}

// § 108 Abs. 3 AO: a deadline on a weekend or holiday moves to the next working day.
const due = (year: number, month: number, day: number) => nextWorkingDay(ymd(year, month, day), germanHolidays);

/**
 * Main federal deadlines. UStVA: 10th of the following month (§ 18 Abs. 1
 * UStG), monthly when the prior-year VAT exceeded EUR 9,000, quarterly above
 * EUR 2,000 (§ 18 Abs. 2 UStG). ZM: 25th after the period (§ 18a UStG).
 * Income-tax prepayments: 10 Mar/Jun/Sep/Dec (§ 37 Abs. 1 EStG). Annual
 * returns without an adviser: 31 July of the following year (§ 149 Abs. 2 AO).
 */
export function germanDeadlines(year: number): CountryTaxDeadline[] {
  const out: CountryTaxDeadline[] = [];
  for (let m = 1; m <= 12; m++) {
    out.push({
      date: due(year, m, 10),
      kind: 'vat_return_monthly',
      title: { de: 'Umsatzsteuer-Voranmeldung (monatlich)', en: 'VAT advance return (monthly)' },
      appliesTo: 'monthly filers (prior-year VAT > EUR 9,000)',
    });
    out.push({
      date: due(year, m, 25),
      kind: 'ec_sales_list',
      title: { de: 'Zusammenfassende Meldung', en: 'EC sales list' },
      appliesTo: 'businesses with intra-EU supplies (quarterly allowed up to EUR 50,000 of goods per quarter)',
    });
  }
  for (const m of [1, 4, 7, 10]) {
    out.push({
      date: due(year, m, 10),
      kind: 'vat_return_quarterly',
      title: { de: 'Umsatzsteuer-Voranmeldung (vierteljährlich)', en: 'VAT advance return (quarterly)' },
      appliesTo: 'quarterly filers (prior-year VAT EUR 2,000–9,000)',
    });
  }
  out.push({
    date: due(year, 2, 10),
    kind: 'vat_special_prepayment',
    title: { de: 'Sondervorauszahlung (Dauerfristverlängerung)', en: 'Special VAT prepayment (filing extension)' },
    appliesTo: 'monthly filers with a permanent one-month extension (§ 47 UStDV)',
  });
  for (const m of [3, 6, 9, 12]) {
    out.push({
      date: due(year, m, 10),
      kind: 'income_tax_prepayment',
      title: { de: 'Einkommensteuer-Vorauszahlung', en: 'Income tax prepayment' },
    });
  }
  out.push({
    date: due(year, 7, 31),
    kind: 'annual_returns',
    title: { de: `Steuererklärungen ${year - 1} (ohne Steuerberater)`, en: `${year - 1} annual tax returns (without an adviser)` },
  });
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

const STANDARD_19 = { rate: 19, kind: 'standard', appliesTo: 'most goods and services' } as const;
const REDUCED_7 = { rate: 7, kind: 'reduced', appliesTo: 'food, books, newspapers, local public transport, hotel stays (Anlage 2 UStG)' } as const;

// § 12 UStG. 2020-07-01 to 2020-12-31: temporary COVID cut (Zweites Corona-Steuerhilfegesetz).
const RATE_SETS: readonly TaxRateSet[] = [
  { validFrom: '2007-01-01', rates: [STANDARD_19, REDUCED_7] },
  { validFrom: '2020-07-01', rates: [{ rate: 16, kind: 'standard' }, { rate: 5, kind: 'reduced' }] },
  { validFrom: '2021-01-01', rates: [STANDARD_19, REDUCED_7] },
  {
    validFrom: '2023-01-01',
    rates: [
      STANDARD_19,
      REDUCED_7,
      // § 12 Abs. 3 UStG (Jahressteuergesetz 2022).
      { rate: 0, kind: 'zero', appliesTo: 'supply and installation of PV systems up to 30 kWp for homes' },
    ],
  },
  {
    validFrom: '2026-01-01',
    rates: [
      STANDARD_19,
      // § 12 Abs. 2 Nr. 15 UStG as amended by the Steueränderungsgesetz 2025: food served in restaurants, drinks stay at 19 %.
      { ...REDUCED_7, appliesTo: 'food (also restaurant meals since 2026, drinks excluded), books, newspapers, local transport, hotel stays' },
      { rate: 0, kind: 'zero', appliesTo: 'supply and installation of PV systems up to 30 kWp for homes' },
    ],
  },
];

export const DE: CountryPack = {
  code: 'DE',
  name: 'Germany',
  region: 'eu',
  euMember: true,
  currency: 'EUR',
  currencyMinorUnits: 2,
  timeZone: 'Europe/Berlin',
  locales: ['de', 'en'],
  subdivisions: [
    { code: 'DE-BW', name: 'Baden-Württemberg' },
    { code: 'DE-BY', name: 'Bayern' },
    { code: 'DE-BE', name: 'Berlin' },
    { code: 'DE-BB', name: 'Brandenburg' },
    { code: 'DE-HB', name: 'Bremen' },
    { code: 'DE-HH', name: 'Hamburg' },
    { code: 'DE-HE', name: 'Hessen' },
    { code: 'DE-MV', name: 'Mecklenburg-Vorpommern' },
    { code: 'DE-NI', name: 'Niedersachsen' },
    { code: 'DE-NW', name: 'Nordrhein-Westfalen' },
    { code: 'DE-RP', name: 'Rheinland-Pfalz' },
    { code: 'DE-SL', name: 'Saarland' },
    { code: 'DE-SN', name: 'Sachsen' },
    { code: 'DE-ST', name: 'Sachsen-Anhalt' },
    { code: 'DE-SH', name: 'Schleswig-Holstein' },
    { code: 'DE-TH', name: 'Thüringen' },
  ],
  taxIds: DE_TAX_IDS,
  indirectTax: {
    kind: 'vat',
    name: { de: 'Umsatzsteuer (USt.)', en: 'VAT (Umsatzsteuer)' },
    rateSets: RATE_SETS,
    // § 19 UStG since 1 Jan 2025 (Jahressteuergesetz 2024): prior year ≤ EUR 25,000 and current year ≤ EUR 100,000, both net.
    smallBusiness: {
      threshold: 25_000,
      currency: 'EUR',
      invoiceNote: {
        de: 'Gemäß § 19 UStG wird keine Umsatzsteuer berechnet (steuerfreier Umsatz als Kleinunternehmer).',
        en: 'No VAT charged – small business exemption under § 19 UStG.',
      },
      source: { title: '§ 19 UStG', url: `${USTG}__19.html` },
    },
    reverseChargeNote: {
      // § 14a Abs. 5 UStG – the wording is prescribed.
      domestic: { de: 'Steuerschuldnerschaft des Leistungsempfängers', en: 'Reverse charge – the recipient is liable for the VAT' },
      crossBorder: { de: 'Steuerschuldnerschaft des Leistungsempfängers', en: 'Reverse charge – the recipient is liable for the VAT' },
    },
    source: { title: '§ 12 UStG', url: `${USTG}__12.html` },
  },
  invoice: {
    // § 14 Abs. 4 UStG; no title is prescribed, but self-billing must say "Gutschrift" (§ 14 Abs. 4 Nr. 10).
    requirements: [
      { field: 'supplier_name', rule: '§ 14 Abs. 4 Nr. 1 UStG' },
      { field: 'supplier_address', rule: '§ 14 Abs. 4 Nr. 1 UStG' },
      { field: 'customer_name', rule: '§ 14 Abs. 4 Nr. 1 UStG', when: 'above_simplified_threshold' },
      { field: 'customer_address', rule: '§ 14 Abs. 4 Nr. 1 UStG', when: 'above_simplified_threshold' },
      // Steuernummer *or* USt-IdNr. – the UI should accept either.
      { field: 'supplier_vat_id', rule: '§ 14 Abs. 4 Nr. 2 UStG', when: 'above_simplified_threshold' },
      { field: 'issue_date', rule: '§ 14 Abs. 4 Nr. 3 UStG' },
      { field: 'invoice_number', rule: '§ 14 Abs. 4 Nr. 4 UStG', when: 'above_simplified_threshold' },
      { field: 'line_description', rule: '§ 14 Abs. 4 Nr. 5 UStG' },
      { field: 'line_quantity', rule: '§ 14 Abs. 4 Nr. 5 UStG' },
      { field: 'supply_date', rule: '§ 14 Abs. 4 Nr. 6 UStG', when: 'above_simplified_threshold' },
      { field: 'tax_rate_per_line', rule: '§ 14 Abs. 4 Nr. 8 UStG' },
      { field: 'tax_amount_per_rate', rule: '§ 14 Abs. 4 Nr. 7–8 UStG', when: 'above_simplified_threshold' },
      { field: 'total_with_tax', rule: '§ 33 UStDV' },
      { field: 'customer_vat_id', rule: '§ 14a Abs. 1 and 3 UStG', when: 'cross_border' },
    ],
    // Kleinbetragsrechnung, § 33 UStDV.
    simplifiedThreshold: { amount: 250, currency: 'EUR' },
    // "Einmalig" (unique), not strictly gapless – § 14 Abs. 4 Nr. 4 UStG, UStAE 14.5 Abs. 10.
    numbering: { gapless: false, multipleSeries: true },
    language: { note: 'No language is prescribed; the tax office may ask for a German translation (§ 87 Abs. 2 AO).' },
    // § 14 Abs. 4 Nr. 8 UStG with § 16 Abs. 6 UStG: tax in EUR when invoicing in a foreign currency.
    homeCurrencyTaxRequired: true,
    // § 14b Abs. 1 UStG and § 147 Abs. 3 AO, 8 years since Bürokratieentlastungsgesetz IV (2025).
    retentionYears: 8,
    source: { title: '§ 14 UStG', url: `${USTG}__14.html` },
  },
  einvoicing: [
    {
      scope: 'b2g',
      model: 'post_audit',
      from: '2020-11-27',
      appliesTo: 'suppliers to the federal administration (Länder have their own dates)',
      formats: ['xrechnung', 'zugferd'],
      platform: 'ZRE / OZG-RE (Peppol, upload, e-mail)',
      source: { title: 'E-Rechnungsverordnung (ERechV)', url: 'https://www.gesetze-im-internet.de/erechv/' },
    },
    {
      scope: 'b2b',
      model: 'post_audit',
      from: '2025-01-01',
      appliesTo: 'every domestic business must be able to receive EN 16931 e-invoices',
      formats: ['xrechnung', 'zugferd', 'peppol_bis'],
      source: { title: 'BMF – FAQ E-Rechnung (§ 14 Abs. 1, § 27 Abs. 38 UStG)', url: BMF_ERECHNUNG },
    },
    {
      scope: 'b2b',
      model: 'post_audit',
      from: '2027-01-01',
      appliesTo: 'issuers with prior-year turnover > EUR 800,000 (Kleinunternehmer and invoices ≤ EUR 250 exempt)',
      formats: ['xrechnung', 'zugferd', 'peppol_bis'],
      source: { title: '§ 27 Abs. 38 Nr. 2 UStG', url: `${USTG}__27.html` },
    },
    {
      scope: 'b2b',
      model: 'post_audit',
      from: '2028-01-01',
      appliesTo: 'all domestic B2B issuers (Kleinunternehmer and invoices ≤ EUR 250 exempt)',
      formats: ['xrechnung', 'zugferd', 'peppol_bis'],
      source: { title: '§ 27 Abs. 38 Nr. 3 UStG', url: `${USTG}__27.html` },
    },
  ],
  payments: {
    iban: true,
    qr: ['epc'],
    reference: 'free_text',
    localMethods: ['sepa', 'sepa_direct_debit', 'paypal', 'card', 'wero'],
  },
  registry: { name: 'Handelsregister / Unternehmensregister', url: 'https://www.handelsregister.de/' },
  holidays: germanHolidays,
  deadlines: germanDeadlines,
  supportLevel: 'pack',
  verifiedAt: '2026-10-21',
  caveats: [
    'Holidays are Länder law. Only the nine nationwide ones are listed; regional ones (Heilige Drei Könige BW/BY/ST, Frauentag BE/MV, Fronleichnam, Mariä Himmelfahrt, Reformationstag, Allerheiligen, Buß- und Bettag SN, Weltkindertag TH) need DE-xx subdivisions in the contract.',
    'Steuernummer check digits differ per Land (11er/2er procedures); only the format is checked.',
    'Kleinunternehmer: the EUR 100,000 current-year limit is a hard cutoff – the supply that crosses it is taxable. The contract has one threshold field, so only the EUR 25,000 prior-year limit is stored here.',
    'Kleinunternehmer may use simplified invoices under § 34a UStDV; the wording of the note is free as long as it points to § 19 UStG.',
    'Supplier ID: § 14 Abs. 4 Nr. 2 UStG wants the Steuernummer or the USt-IdNr.; the contract cannot express "one of", so supplier_vat_id is listed.',
    'Invoices to private recipients for work on real property must mention the two-year retention duty (§ 14 Abs. 4 Nr. 9 UStG).',
    'Annual-return deadlines: the COVID extensions for advised filers phase out; check the current § 149 Abs. 3 AO dates each year.',
    'Number formats for Handelsregister are format-only, the court (Registergericht) must be stored separately.',
  ],
  sources: [
    { title: 'Umsatzsteuergesetz (UStG)', url: USTG },
    { title: 'Umsatzsteuer-Durchführungsverordnung (UStDV)', url: 'https://www.gesetze-im-internet.de/ustdv_1980/' },
    { title: 'Abgabenordnung (AO)', url: 'https://www.gesetze-im-internet.de/ao_1977/' },
    { title: 'BMF – FAQ E-Rechnung', url: BMF_ERECHNUNG },
    { title: 'XRechnung (KoSIT)', url: 'https://xeinkauf.de/xrechnung/' },
    { title: 'ZUGFeRD (FeRD)', url: 'https://www.ferd-net.de/' },
    { title: 'IHK Frankfurt – 7 % auf Speisen ab 2026', url: 'https://www.frankfurt-main.ihk.de/branchenthemen/portal-gastronomie-tourismus-und-gesundheitswirtschaft/wichtige-informationen-zum-gaststaettengewerbe/news-fuer-die-gastronomie/reduzierter-mehrwertsteuersatz-6847546' },
  ],
};
