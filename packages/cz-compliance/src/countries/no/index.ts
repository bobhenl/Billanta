import type { CountryPack, Source } from '../types.js';
import { noDeadlines, noHolidays } from './calendar.js';
import { isValidNoBankAccount, isValidOrgNumber, normalizeOrgNumber } from './tax-ids.js';

export { noDeadlines, noHolidays } from './calendar.js';
export { formatNoVatNumber, isValidNoBankAccount, isValidOrgNumber, normalizeOrgNumber } from './tax-ids.js';

const BOKFORINGSFORSKRIFTEN: Source = {
  title: 'Bokføringsforskriften (FOR-2004-12-01-1558) § 5-1-1 – salgsdokumentets innhold',
  url: 'https://lovdata.no/dokument/SF/forskrift/2004-12-01-1558',
};
const BOKFORINGSLOVEN: Source = {
  title: 'Bokføringsloven (LOV-2004-11-19-73) § 13 – oppbevaring',
  url: 'https://lovdata.no/dokument/NL/lov/2004-11-19-73',
};
const MVA_LOVEN: Source = {
  title: 'Merverdiavgiftsloven (LOV-2009-06-19-58) §§ 2-1, 5-1 to 6-1',
  url: 'https://lovdata.no/dokument/NL/lov/2009-06-19-58',
};
const MVA_RATES: Source = {
  title: 'Skatteetaten – Merverdiavgift: satser',
  url: 'https://www.skatteetaten.no/satser/merverdiavgift/',
};
const B2B_EINVOICE: Source = {
  title: 'KPMG – Norway: final digital reporting and e-invoicing regulations (September 2026)',
  url: 'https://kpmg.com/us/en/taxnewsflash/news/2026/10/norway-final-digital-reporting-e-invoicing-regulations.html',
};
const B2G_EHF: Source = {
  title: 'DFØ – Elektronisk faktura (EHF) til offentlig sektor; forskrift om elektronisk faktura i offentlige anskaffelser',
  url: 'https://anskaffelser.no/verktoy/veiledere/elektronisk-faktura',
};

/** Norway. EEA, not EU; VAT (merverdiavgift, MVA) under merverdiavgiftsloven. */
export const NO: CountryPack = {
  code: 'NO',
  name: 'Norway',
  region: 'europe',
  euMember: false,
  currency: 'NOK',
  currencyMinorUnits: 2,
  timeZone: 'Europe/Oslo',
  locales: ['en'],
  taxIds: [
    {
      kind: 'company',
      label: { en: 'Organisation number', nb: 'Organisasjonsnummer' },
      // Equinor ASA, a public Brønnøysund record.
      example: '923 609 016',
      normalize: normalizeOrgNumber,
      validate: isValidOrgNumber,
      // Bokføringsforskriften § 5-1-1 nr. 2: seller's organisation number.
      requiredOnInvoice: true,
      source: BOKFORINGSFORSKRIFTEN,
    },
    {
      kind: 'vat',
      label: { en: 'VAT number', nb: 'MVA-nummer' },
      example: 'NO 923 609 016 MVA',
      normalize: normalizeOrgNumber,
      validate: isValidOrgNumber,
      // Bokføringsforskriften § 5-1-1 nr. 2: registered sellers add the letters "MVA" to the organisation number.
      requiredOnInvoice: true,
      source: BOKFORINGSFORSKRIFTEN,
    },
  ],
  indirectTax: {
    kind: 'vat',
    name: { en: 'VAT', nb: 'Merverdiavgift (MVA)' },
    rateSets: [
      {
        // The Covid low rate (6% → 12%) ended 30 September 2021; rates unchanged since.
        validFrom: '2021-10-01',
        rates: [
          { rate: 25, kind: 'standard' },
          { rate: 15, kind: 'reduced', appliesTo: 'food and non-alcoholic drinks' },
          { rate: 12, kind: 'reduced', appliesTo: 'passenger transport, accommodation, cinema, museums, sports events' },
          { rate: 0, kind: 'zero', appliesTo: 'books, newspapers, exports and some electric vehicles' },
        ],
      },
    ],
    // Merverdiavgiftsloven § 2-1: register once taxable turnover exceeds NOK 50,000 in 12 months.
    registrationThreshold: { amount: 50000, currency: 'NOK' },
    reverseChargeNote: {
      domestic: { en: 'Reverse charge – the buyer accounts for VAT (merverdiavgiftsloven § 11-1)', nb: 'Omvendt avgiftsplikt, jf. merverdiavgiftsloven § 11-1' },
      crossBorder: { en: 'Reverse charge – the buyer accounts for VAT', nb: 'Omvendt avgiftsplikt' },
    },
    source: MVA_RATES,
  },
  invoice: {
    // Bokføringsforskriften § 5-1-1; "Faktura" is customary, not prescribed.
    requirements: [
      { field: 'invoice_number', rule: 'Bokføringsforskriften § 5-1-1 nr. 1 – number in a controllable series' },
      { field: 'issue_date', rule: 'Bokføringsforskriften § 5-1-1 nr. 1' },
      { field: 'supplier_name', rule: 'Bokføringsforskriften § 5-1-1 nr. 2' },
      { field: 'supplier_company_id', rule: 'Bokføringsforskriften § 5-1-1 nr. 2' },
      { field: 'supplier_vat_id', when: 'tax_registered', rule: 'Bokføringsforskriften § 5-1-1 nr. 2 – org. number + "MVA"' },
      { field: 'supplier_address', rule: 'Bokføringsforskriften § 5-1-1 nr. 2' },
      { field: 'customer_name', rule: 'Bokføringsforskriften § 5-1-1 nr. 3' },
      { field: 'customer_address', rule: 'Bokføringsforskriften § 5-1-1 nr. 3' },
      { field: 'customer_vat_id', when: 'b2b', rule: 'Bokføringsforskriften § 5-1-1 nr. 3 – buyer’s org. number for businesses' },
      { field: 'line_description', rule: 'Bokføringsforskriften § 5-1-1 nr. 4 – type and scope of the supply' },
      { field: 'line_quantity', rule: 'Bokføringsforskriften § 5-1-1 nr. 4' },
      { field: 'supply_date', rule: 'Bokføringsforskriften § 5-1-1 nr. 5 – date and place of delivery' },
      { field: 'line_unit_price', rule: 'Bokføringsforskriften § 5-1-1 nr. 6' },
      { field: 'due_date', rule: 'Bokføringsforskriften § 5-1-1 nr. 6 – payment due date' },
      { field: 'tax_amount_per_rate', when: 'tax_registered', rule: 'Bokføringsforskriften § 5-1-1 nr. 7' },
      { field: 'tax_rate_per_line', when: 'tax_registered', rule: 'Bokføringsforskriften § 5-1-1 nr. 7' },
      { field: 'total_with_tax', rule: 'Bokføringsforskriften § 5-1-1 nr. 6' },
      { field: 'tax_in_local_currency', when: 'tax_registered', rule: 'Bokføringsforskriften § 5-1-1 nr. 7 – VAT in NOK' },
    ],
    numbering: { gapless: true, multipleSeries: true },
    homeCurrencyTaxRequired: true,
    // Bokføringsloven § 13: sales documents kept 5 years after the end of the financial year.
    retentionYears: 5,
    source: BOKFORINGSFORSKRIFTEN,
  },
  einvoicing: [
    {
      scope: 'b2g',
      model: 'peppol_exchange',
      from: '2019-04-01',
      appliesTo: 'all invoices to central and local government bodies',
      formats: ['peppol_bis', 'ehf'],
      platform: 'Peppol (ELMA)',
      source: B2G_EHF,
    },
    {
      scope: 'b2b',
      model: 'peppol_exchange',
      from: '2027-01-01',
      appliesTo:
        'VAT-registered issuers must send e-invoices to recipients registered in ELMA; receiving obligation and digital bookkeeping from 2030',
      formats: ['peppol_bis', 'ehf'],
      platform: 'Peppol (ELMA)',
      source: B2B_EINVOICE,
    },
  ],
  payments: {
    iban: false,
    validateDomesticAccount: isValidNoBankAccount,
    reference: 'free_text',
    localMethods: ['vipps', 'efaktura', 'avtalegiro'],
  },
  registry: {
    name: 'Brønnøysundregistrene – Enhetsregisteret',
    url: 'https://www.brreg.no/',
    api: {
      url: 'https://data.brreg.no/enhetsregisteret/api/enheter/{orgnr}',
      auth: 'none',
      notes: 'Free open data; the response says whether the entity is in Merverdiavgiftsregisteret (registrertIMvaregisteret).',
    },
  },
  holidays: noHolidays,
  deadlines: noDeadlines,
  supportLevel: 'pack',
  verifiedAt: '2026-10-28',
  caveats: [
    'KID (kundeidentifikasjon) is the standard Norwegian payment reference (mod 10 / mod 11), but the contract has no "kid" reference type, so free_text is used.',
    'Companies registered in Foretaksregisteret must also print "Foretaksregisteret" next to the org. number (foretaksregisterloven § 10-2); there is no field for this text.',
    'B2B e-invoicing from 1 January 2027 is based on the final regulations of 29 September 2026 as reported by KPMG (secondary source); the Lovdata text was not checked. Until 2030 it only applies when the recipient is registered in ELMA.',
    'Rate history before October 2021 (Covid-era 6% and 12%) is not modelled. 11.11% applies to raw fish sales via fishermen’s organisations and is left out. Food-rate changes discussed in the 2026 budget were not confirmed – check Skatteetaten before launch.',
    'VAT terms: only the standard two-month term is modelled; annual (årstermin) and primary-industry terms differ. The deadline roll-forward to the next working day is applied to all deadlines.',
    'The skattemelding deadline of 31 May applies to the self-employed; companies (AS) file the same date but via different forms.',
    'No Norwegian (nb) UI locale exists in the app yet; labels carry nb text for when it does.',
    'Bank account check is mod 11 only; accounts of type 2 and some old accounts with a "-" check digit are not handled.',
  ],
  sources: [
    BOKFORINGSFORSKRIFTEN,
    BOKFORINGSLOVEN,
    MVA_LOVEN,
    MVA_RATES,
    B2B_EINVOICE,
    B2G_EHF,
    { title: 'Lov om helligdager og helligdagsfred (LOV-1995-02-24-12)', url: 'https://lovdata.no/dokument/NL/lov/1995-02-24-12' },
    { title: 'Skatteetaten – Frister for mva-meldingen', url: 'https://www.skatteetaten.no/bedrift-og-organisasjon/avgifter/mva/levere/frister/' },
  ],
};
