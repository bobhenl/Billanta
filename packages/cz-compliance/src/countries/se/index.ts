import type { CountryPack, CountryTaxDeadline, Source } from '../types.js';
import { easterOffset, isoList, nextWorkingDay, weekdayOnOrAfter, ymd } from './calendar.js';
import { isValidBankgiro, isValidOrgNr, isValidPlusgiro, isValidSeVat, normalizeOrgNr, normalizeSeVat } from './ids.js';

export * from './ids.js';

const ML: Source = {
  title: 'Mervärdesskattelag (2023:200)',
  url: 'https://www.riksdagen.se/sv/dokument-och-lagar/dokument/svensk-forfattningssamling/mervardesskattelag-2023200_sfs-2023-200/',
};
const SKV_RATES: Source = {
  title: 'Skatteverket – Momssats på varor och tjänster',
  url: 'https://www.skatteverket.se/foretag/moms/saljavarorochtjanster/momssatspavarorochtjanster.4.58d555751259e4d66168000409.html',
};
const FOOD_CUT: Source = {
  title: 'Riksdagen – Temporarily reduced VAT on food (25 Feb 2026)',
  url: 'https://www.riksdagen.se/en/news/articles/2026/feb/25/temporarily-reduced-vat-on-food_cmsd274f5ec-c794-4c1f-8eaf-7811a27dfcb5en/',
};
const SKV_EXEMPT: Source = {
  title: 'Skatteverket – Momsbefrielse (omsättning högst 120 000 kr)',
  url: 'https://skatteverket.se/momsbefrielse',
};
const SKV_INVOICE: Source = {
  title: 'Skatteverket – Fakturering (krav på fakturans innehåll)',
  url: 'https://www.skatteverket.se/foretag/moms/saljavarorochtjanster/fakturering.4.58d555751259e4d661680000.html',
};
const BFL: Source = {
  title: 'Bokföringslag (1999:1078) 7 kap. 2 §',
  url: 'https://www.riksdagen.se/sv/dokument-och-lagar/dokument/svensk-forfattningssamling/bokforingslag-19991078_sfs-1999-1078/',
};
const DIGG: Source = {
  title: 'DIGG – E-faktura till offentlig sektor (lag 2018:1277)',
  url: 'https://www.digg.se/digitala-tjanster/e-handel/regler-och-krav-for-e-handel/lag-om-e-faktura-vid-offentlig-upphandling',
};
const HELGDAGAR: Source = {
  title: 'Lag (1989:253) om allmänna helgdagar',
  url: 'https://www.riksdagen.se/sv/dokument-och-lagar/dokument/svensk-forfattningssamling/lag-1989253-om-allmanna-helgdagar_sfs-1989-253/',
};
const SKV_DEADLINES: Source = {
  title: 'Skatteverket – Deklarations- och betalningsdagar för moms',
  url: 'https://www.skatteverket.se/foretag/moms/deklareramoms',
};

/**
 * Days off: the public holidays of Lag (1989:253) plus Midsummer Eve,
 * Christmas Eve and New Year's Eve, which are not "allmänna helgdagar" but
 * are treated as Sundays by the Holiday Act and close banks and Skatteverket
 * deadlines move past them.
 */
function holidays(year: number): string[] {
  return isoList([
    ymd(year, 1, 1),
    ymd(year, 1, 6), // trettondedag jul
    easterOffset(year, -2), // långfredagen
    easterOffset(year, 0),
    easterOffset(year, 1),
    ymd(year, 5, 1),
    easterOffset(year, 39), // Kristi himmelsfärdsdag
    easterOffset(year, 49), // pingstdagen
    ymd(year, 6, 6), // nationaldagen
    weekdayOnOrAfter(year, 6, 19, 5), // midsommarafton, Friday 19–25 June
    weekdayOnOrAfter(year, 6, 20, 6), // midsommardagen, Saturday 20–26 June
    weekdayOnOrAfter(year, 10, 31, 6), // alla helgons dag, Saturday 31 Oct–6 Nov
    ymd(year, 12, 24),
    ymd(year, 12, 25),
    ymd(year, 12, 26),
    ymd(year, 12, 31),
  ]);
}

/**
 * Momsdeklaration due dates for businesses with taxable turnover up to
 * SEK 40 million (Skatteförfarandelagen 26 kap. 33 §): the 12th of the second
 * month after the period, except that the June / Q2 return is due 17 August
 * (summer extension). Moved to the next working day when it falls on a
 * weekend or holiday.
 */
function deadlines(year: number): CountryTaxDeadline[] {
  const off = holidays(year);
  const title = (sv: string, en: string) => ({ sv, en });
  const out: CountryTaxDeadline[] = [];
  for (let m = 1; m <= 12; m++) {
    // The return due in month m covers month m − 2 (m = 1 covers November, m = 2 December).
    const day = m === 8 ? 17 : 12;
    out.push({
      date: nextWorkingDay(ymd(year, m, day), off),
      kind: 'vat_return_monthly',
      title: title('Momsdeklaration (månadsvis)', 'VAT return (monthly)'),
      appliesTo: 'monthly VAT filers with turnover ≤ SEK 40 million',
    });
  }
  for (const [m, d] of [[2, 12], [5, 12], [8, 17], [11, 12]] as const) {
    out.push({
      date: nextWorkingDay(ymd(year, m, d), off),
      kind: 'vat_return_quarterly',
      title: title('Momsdeklaration (kvartal)', 'VAT return (quarterly)'),
      appliesTo: 'quarterly VAT filers with turnover ≤ SEK 1 million',
    });
  }
  return out;
}

export const SE: CountryPack = {
  code: 'SE',
  name: 'Sweden',
  region: 'eu',
  euMember: true,
  currency: 'SEK',
  currencyMinorUnits: 2,
  // Öresavrundning: cash payments round to whole kronor (Riksbanken, since 2010).
  cashRounding: 1,
  timeZone: 'Europe/Stockholm',
  locales: ['sv', 'en'],
  taxIds: [
    {
      kind: 'company',
      label: { sv: 'Organisationsnummer', en: 'Company registration number' },
      example: '202100-5448',
      normalize: normalizeOrgNr,
      validate: isValidOrgNr,
      // ML 17 kap. 24 § asks for the VAT number, not the orgnr; Aktiebolagslagen 28 kap. 1 § wants the orgnr on an AB's business letters.
      requiredOnInvoice: false,
      source: { title: 'Skatteverket – Organisationsnummer (SKV 709)', url: 'https://www.skatteverket.se/foretag/drivaforetag' },
    },
    {
      kind: 'vat',
      label: { sv: 'Momsregistreringsnummer', en: 'VAT number' },
      example: 'SE202100544801',
      normalize: normalizeSeVat,
      validate: isValidSeVat,
      requiredOnInvoice: true,
      source: ML,
    },
  ],
  indirectTax: {
    kind: 'vat',
    name: { sv: 'Moms', en: 'VAT' },
    // ML 9 kap. (reduced rates). Rates unchanged since 1 Jan 2023 apart from the food cut below.
    rateSets: [
      {
        validFrom: '2023-07-01',
        rates: [
          { rate: 25, kind: 'standard' },
          { rate: 12, kind: 'reduced', appliesTo: 'food, restaurant and catering services, hotel accommodation' },
          { rate: 6, kind: 'reduced', appliesTo: 'books, newspapers, passenger transport, cultural and sports events' },
          { rate: 0, kind: 'zero', appliesTo: 'intra-EU supplies, exports, prescription medicines' },
        ],
      },
      {
        // Temporary cut on food (not restaurant services) 1 Apr 2026 – 31 Dec 2027.
        validFrom: '2026-04-01',
        rates: [
          { rate: 25, kind: 'standard' },
          { rate: 12, kind: 'reduced', appliesTo: 'restaurant and catering services, hotel accommodation' },
          { rate: 6, kind: 'reduced', appliesTo: 'food (temporary until 31 Dec 2027), books, newspapers, passenger transport, culture' },
          { rate: 0, kind: 'zero', appliesTo: 'intra-EU supplies, exports, prescription medicines' },
        ],
      },
      {
        validFrom: '2028-01-01',
        rates: [
          { rate: 25, kind: 'standard' },
          { rate: 12, kind: 'reduced', appliesTo: 'food, restaurant and catering services, hotel accommodation' },
          { rate: 6, kind: 'reduced', appliesTo: 'books, newspapers, passenger transport, cultural and sports events' },
          { rate: 0, kind: 'zero', appliesTo: 'intra-EU supplies, exports, prescription medicines' },
        ],
      },
    ],
    smallBusiness: {
      // ML 18 kap. (since 1 Jan 2025): turnover ≤ SEK 120,000 in the current and the two previous years.
      threshold: 120_000,
      currency: 'SEK',
      invoiceNote: {
        sv: 'Momsbefriad enligt 18 kap. mervärdesskattelagen (2023:200).',
        en: 'VAT exempt under Chapter 18 of the Swedish VAT Act (2023:200).',
      },
      source: SKV_EXEMPT,
    },
    reverseChargeNote: {
      // ML 17 kap. 24 § p. 11: the invoice must say "omvänd betalningsskyldighet".
      domestic: { sv: 'Omvänd betalningsskyldighet', en: 'Reverse charge' },
      crossBorder: { sv: 'Omvänd betalningsskyldighet', en: 'Reverse charge' },
    },
    source: SKV_RATES,
  },
  invoice: {
    // ML 17 kap. 24 § (full invoice), 17 kap. 29–30 §§ (simplified).
    requirements: [
      { field: 'issue_date', rule: 'ML 17 kap. 24 § p. 1' },
      { field: 'invoice_number', rule: 'ML 17 kap. 24 § p. 2' },
      { field: 'supplier_vat_id', when: 'tax_registered', rule: 'ML 17 kap. 24 § p. 3' },
      { field: 'customer_vat_id', when: 'cross_border', rule: 'ML 17 kap. 24 § p. 4' },
      { field: 'supplier_name', rule: 'ML 17 kap. 24 § p. 5' },
      { field: 'supplier_address', rule: 'ML 17 kap. 24 § p. 5' },
      { field: 'customer_name', rule: 'ML 17 kap. 24 § p. 5' },
      { field: 'customer_address', rule: 'ML 17 kap. 24 § p. 5' },
      { field: 'line_description', rule: 'ML 17 kap. 24 § p. 6' },
      { field: 'line_quantity', rule: 'ML 17 kap. 24 § p. 6' },
      { field: 'supply_date', rule: 'ML 17 kap. 24 § p. 7' },
      { field: 'line_unit_price', rule: 'ML 17 kap. 24 § p. 8' },
      { field: 'tax_rate_per_line', rule: 'ML 17 kap. 24 § p. 9' },
      { field: 'tax_amount_per_rate', rule: 'ML 17 kap. 24 § p. 10' },
      { field: 'tax_in_local_currency', rule: 'ML 17 kap. 27 § (art. 230 VAT Directive)' },
    ],
    simplifiedThreshold: { amount: 4_000, currency: 'SEK' },
    numbering: { gapless: false, multipleSeries: true },
    homeCurrencyTaxRequired: true,
    retentionYears: 7,
    source: SKV_INVOICE,
  },
  einvoicing: [
    {
      scope: 'b2g',
      model: 'peppol_exchange',
      from: '2019-04-01',
      appliesTo: 'suppliers to Swedish public bodies under public procurement',
      formats: ['peppol_bis'],
      platform: 'Peppol',
      source: DIGG,
    },
  ],
  payments: {
    iban: true,
    validateDomesticAccount: (v) => isValidBankgiro(v) || isValidPlusgiro(v),
    // OCR references are Luhn numbers (see isValidOcrReference); the contract has no 'se_ocr' kind yet.
    reference: 'free_text',
    localMethods: ['bankgiro', 'plusgiro', 'swish', 'autogiro'],
  },
  registry: { name: 'Bolagsverket', url: 'https://www.bolagsverket.se' },
  holidays,
  deadlines,
  supportLevel: 'pack',
  verifiedAt: '2026-10-21',
  caveats: [
    'Mandatory invoice fields follow ML 17 kap. 24 § from memory of the act; paragraph numbers were not re-read for this pass.',
    'Simplified invoice limit SEK 4,000 (Skatteverket guidance) not re-confirmed.',
    'Food VAT returns from 6 % to 12 % on 1 Jan 2028 unless extended – recheck in late 2027.',
    'Deadlines cover only monthly/quarterly filers ≤ SEK 40 million; large businesses (26th of the following month) and annual filers are missing. Check against Skatteverket’s calendar.',
    'Small-business exemption note text is our wording; Skatteverket prescribes no exact sentence, only that no VAT may be shown.',
    'Gapless numbering is not strictly required in Sweden (an unbroken series is "good practice"); treat as non-gapless but warn on gaps.',
    'Retention: Bokföringslagen 7 years from the end of the calendar year.',
    'Swish and OCR references are not modelled by the contract (reference kind, QR schemes).',
  ],
  sources: [ML, SKV_RATES, FOOD_CUT, SKV_EXEMPT, SKV_INVOICE, BFL, DIGG, HELGDAGAR, SKV_DEADLINES],
};
