import type { CountryPack, Source } from '../types.js';
import { beDeadlines, beHolidays } from './calendar.js';
import { normalizeBeEnterprise, normalizeBeVat, validateBeEnterprise, validateBeVat } from './tax-ids.js';

export * from './tax-ids.js';
export * from './structured-communication.js';
export * from './calendar.js';

const FIN_EINVOICING: Source = {
  title: 'FOD Financiën – E-facturatie (verplicht vanaf 1 januari 2026)',
  url: 'https://financien.belgium.be/nl/ondernemingen/btw/e-facturatie',
};
const FIN_INVOICE: Source = {
  title: 'FOD Financiën – Uitreiking van facturen (KB nr. 1, art. 5)',
  url: 'https://financien.belgium.be/nl/ondernemingen/btw/facturering',
};
const FIN_FRANCHISE: Source = {
  title: 'FOD Financiën – Vrijstellingsregeling voor kleine ondernemingen',
  url: 'https://financien.belgium.be/nl/ondernemingen/btw/bijzondere-regelingen/vrijstellingsregeling-kleine-ondernemingen',
};
const FIN_RATES: Source = {
  title: 'FOD Financiën – Btw-tarieven',
  url: 'https://financien.belgium.be/nl/ondernemingen/btw/tarieven',
};
const KBO: Source = {
  title: 'KBO Public Search / Open Data',
  url: 'https://economie.fgov.be/nl/themas/ondernemingen/kruispuntbank-van/diensten-voor-iedereen/kbo-open-data',
};

export const BE: CountryPack = {
  code: 'BE',
  name: 'Belgium',
  region: 'eu',
  euMember: true,
  currency: 'EUR',
  currencyMinorUnits: 2,
  timeZone: 'Europe/Brussels',
  locales: ['nl', 'fr', 'de', 'en'],
  taxIds: [
    {
      kind: 'company',
      label: { nl: 'Ondernemingsnummer', fr: "Numéro d'entreprise", de: 'Unternehmensnummer', en: 'Enterprise number' },
      example: '0202.239.951',
      normalize: normalizeBeEnterprise,
      validate: validateBeEnterprise,
      // Wetboek van vennootschappen en verenigingen art. 2:20: enterprise number + "RPR/RPM" + court seat.
      requiredOnInvoice: true,
      source: KBO,
    },
    {
      kind: 'vat',
      label: { nl: 'Btw-nummer', fr: 'Numéro de TVA', de: 'MwSt-Nummer', en: 'VAT number' },
      example: 'BE0202239951',
      normalize: normalizeBeVat,
      validate: validateBeVat,
      requiredOnInvoice: true,
      source: FIN_INVOICE,
    },
  ],
  indirectTax: {
    kind: 'vat',
    name: { nl: 'btw', fr: 'TVA', de: 'MwSt', en: 'VAT' },
    // Btw-Wetboek art. 37 and KB nr. 20 (tables A–C). 21 % since 1996-01-01.
    rateSets: [
      {
        validFrom: '1996-01-01',
        rates: [
          { rate: 21, kind: 'standard' },
          { rate: 12, kind: 'reduced', appliesTo: 'restaurant meals (excl. drinks), social housing, some energy products' },
          { rate: 6, kind: 'reduced', appliesTo: 'food, water, books, medicines, renovation of homes over 10 years' },
          { rate: 0, kind: 'zero', appliesTo: 'daily newspapers, some recycled goods' },
        ],
      },
      {
        // Hotel and camping accommodation moved from 6 % to 12 % (Programme law 2026).
        validFrom: '2026-03-01',
        rates: [
          { rate: 21, kind: 'standard' },
          { rate: 12, kind: 'reduced', appliesTo: 'restaurant meals (excl. drinks), hotel and camping accommodation, social housing' },
          { rate: 6, kind: 'reduced', appliesTo: 'food, water, books, medicines, renovation of homes over 10 years' },
          { rate: 0, kind: 'zero', appliesTo: 'daily newspapers, some recycled goods' },
        ],
      },
    ],
    smallBusiness: {
      // Btw-Wetboek art. 56bis, threshold EUR 25,000 (raised from 15,000 in 2016).
      threshold: 25_000,
      currency: 'EUR',
      invoiceNote: {
        nl: 'Bijzondere vrijstellingsregeling kleine ondernemingen',
        fr: 'Régime particulier de franchise des petites entreprises',
        de: 'Sonderregelung für Kleinunternehmen',
        en: 'Special exemption scheme for small enterprises',
      },
      source: FIN_FRANCHISE,
    },
    reverseChargeNote: {
      // KB nr. 1 art. 5 §1, 11°: domestic reverse charge (construction work, art. 20 KB nr. 1).
      domestic: {
        nl: 'Verlegging van heffing',
        fr: 'Autoliquidation',
        de: 'Verlagerung der Steuerschuld',
        en: 'Reverse charge',
      },
      crossBorder: {
        nl: 'Verlegging van heffing',
        fr: 'Autoliquidation',
        de: 'Verlagerung der Steuerschuld',
        en: 'Reverse charge',
      },
    },
    source: FIN_RATES,
  },
  invoice: {
    // KB nr. 1 (Royal Decree no. 1) art. 5 §1 lists the mentions.
    requirements: [
      { field: 'issue_date', rule: 'KB nr. 1 art. 5 §1, 1°' },
      { field: 'invoice_number', rule: 'KB nr. 1 art. 5 §1, 2°' },
      { field: 'supplier_name', rule: 'KB nr. 1 art. 5 §1, 3°' },
      { field: 'supplier_address', rule: 'KB nr. 1 art. 5 §1, 3°' },
      { field: 'supplier_vat_id', when: 'tax_registered', rule: 'KB nr. 1 art. 5 §1, 4°' },
      { field: 'supplier_company_id', rule: 'WVV art. 2:20 (ondernemingsnummer + RPR/RPM)' },
      { field: 'customer_name', rule: 'KB nr. 1 art. 5 §1, 5°' },
      { field: 'customer_address', rule: 'KB nr. 1 art. 5 §1, 5°' },
      { field: 'customer_vat_id', when: 'b2b', rule: 'KB nr. 1 art. 5 §1, 6°' },
      { field: 'supply_date', rule: 'KB nr. 1 art. 5 §1, 7°' },
      { field: 'line_quantity', rule: 'KB nr. 1 art. 5 §1, 8°' },
      { field: 'line_description', rule: 'KB nr. 1 art. 5 §1, 8°' },
      { field: 'line_unit_price', rule: 'KB nr. 1 art. 5 §1, 9°' },
      { field: 'tax_rate_per_line', rule: 'KB nr. 1 art. 5 §1, 10°' },
      { field: 'tax_amount_per_rate', rule: 'KB nr. 1 art. 5 §1, 10°' },
      { field: 'total_with_tax', rule: 'KB nr. 1 art. 5 §1, 9°–10°' },
      { field: 'tax_in_local_currency', rule: 'Btw-Wetboek art. 53 §2; Directive 2006/112/EC art. 230' },
    ],
    numbering: { gapless: true, multipleSeries: true },
    language: {
      required: ['nl', 'fr', 'de'],
      note: 'Language follows the operating seat: Dutch in Flanders (decreet van 19 juli 1973), French in Wallonia, German in the German-speaking Community, free choice in Brussels. A translation may be added.',
    },
    homeCurrencyTaxRequired: true,
    // Btw-Wetboek art. 60 §3: 10 years for documents of periods from 2023.
    retentionYears: 10,
    source: FIN_INVOICE,
  },
  einvoicing: [
    {
      scope: 'b2g',
      model: 'peppol_exchange',
      from: 'in_force',
      appliesTo: 'suppliers of federal and Flemish public bodies (Mercurius)',
      formats: ['peppol_bis'],
      platform: 'Mercurius / Peppol',
      source: { title: 'BOSA – Peppol e-invoicing', url: 'https://bosa.belgium.be/en/services/peppol-e-invoicing' },
    },
    {
      // Wet van 6 februari 2024, KB van 8 juli 2025.
      scope: 'b2b',
      model: 'peppol_exchange',
      from: '2026-01-01',
      appliesTo: 'every Belgian VAT-registered business for domestic B2B supplies; not franchise (art. 56bis), art. 44-exempt, flat-rate farmers or businesses in bankruptcy',
      formats: ['peppol_bis'],
      platform: 'Peppol',
      source: FIN_EINVOICING,
    },
    {
      // Draft law approved by the federal government on 2026-07-18; not yet enacted.
      scope: 'b2b',
      model: 'real_time_reporting',
      from: '2028-01-01',
      appliesTo: 'DRAFT – near real-time reporting of B2B invoice data through Peppol access points (five-corner); replaces the annual client listing',
      formats: ['peppol_bis'],
      platform: 'Peppol access points → FOD Financiën',
      source: FIN_EINVOICING,
    },
  ],
  payments: {
    iban: true,
    qr: ['epc'],
    reference: 'be_structured',
    localMethods: ['sepa', 'bancontact', 'wero'],
  },
  registry: {
    name: 'Kruispuntbank van Ondernemingen (KBO/BCE)',
    url: 'https://kbopub.economie.fgov.be/kbopub/zoeknummerform.html',
    api: {
      url: 'https://economie.fgov.be/nl/themas/ondernemingen/kruispuntbank-van/diensten-voor-iedereen/kbo-open-data',
      auth: 'api_key',
      notes: 'Free monthly Open Data dump plus daily updates after registration; live KBO web services are paid.',
    },
  },
  holidays: beHolidays,
  deadlines: beDeadlines,
  supportLevel: 'pack',
  verifiedAt: '2026-10-21',
  caveats: [
    'Mentions that do not fit InvoiceField: legal form, registered office, "RPR/RPM" with the court seat, website and e-mail (WVV art. 2:20); legal mention for intra-EU or exempt supplies with the article.',
    'Franchise invoice note: "Régime particulier de franchise des petites entreprises" / "Bijzondere vrijstellingsregeling kleine ondernemingen" confirmed by advisers, not read in the coordinated VAT Code; the German wording is our translation.',
    'Rate scope: the 2026 move of takeaway meals, sport and culture to 12 % was withdrawn after the Council of State review; only hotels and camping moved (transition for bookings before 2026-02-28). Re-check each budget.',
    'Weekend rule: from 2026 the quarterly deadline (25th) is no longer moved to the next working day while monthly ones are (KPMG); sources disagree. beDeadlines returns nominal dates; summer extensions are not modelled.',
    'Quarterly VAT advances (abolished for most quarterly filers by the VAT chain reform) are not listed; check whether any remain.',
    'E-reporting 2028 is a draft law (approved by the cabinet on 2026-07-18).',
    'Whether franchise businesses must be able to receive Peppol invoices: current guidance says they are excluded on both sides (verify).',
    'Flemish language decree status for cross-border invoices after CJEU C-15/15 (New Valmar) not re-checked.',
    'Wero is replacing Payconiq in Belgium during 2026 (secondary sources).',
  ],
  sources: [FIN_EINVOICING, FIN_INVOICE, FIN_FRANCHISE, FIN_RATES, KBO],
};
