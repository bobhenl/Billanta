import type { CountryPack, Source } from '../types.js';
import { frDeadlines, frHolidays } from './calendar.js';
import {
  normalizeFrDigits,
  normalizeFrVat,
  validateFrVat,
  validateSiren,
  validateSiret,
} from './tax-ids.js';

export * from './tax-ids.js';
export * from './calendar.js';

const LEGIFRANCE_242_NONIES_A: Source = {
  title: 'CGI annexe II, art. 242 nonies A – mentions obligatoires des factures',
  url: 'https://www.legifrance.gouv.fr/codes/section_lc/LEGITEXT000006069569/LEGISCTA000006179646/',
};
const SP_MENTIONS: Source = {
  title: 'Service-public.fr – Mentions obligatoires sur une facture',
  url: 'https://entreprendre.service-public.fr/vosdroits/F31808',
};
const SP_FRANCHISE: Source = {
  title: 'Service-public.fr – Franchise en base de TVA',
  url: 'https://entreprendre.service-public.fr/vosdroits/F21746',
};
const IMPOTS_EINVOICING: Source = {
  title: 'impots.gouv.fr – Je passe à la facturation électronique',
  url: 'https://www.impots.gouv.fr/professionnel/je-passe-la-facturation-electronique',
};
const SP_TAUX: Source = {
  title: 'Service-public.fr – Taux de TVA',
  url: 'https://entreprendre.service-public.fr/vosdroits/F23567',
};

export const FR: CountryPack = {
  code: 'FR',
  name: 'France',
  region: 'eu',
  euMember: true,
  currency: 'EUR',
  currencyMinorUnits: 2,
  timeZone: 'Europe/Paris',
  locales: ['fr', 'en'],
  taxIds: [
    {
      kind: 'company',
      label: { fr: 'SIREN', en: 'SIREN' },
      example: '443 061 841',
      normalize: normalizeFrDigits,
      validate: validateSiren,
      // Code de commerce R123-237: SIREN on every invoice and business letter.
      requiredOnInvoice: true,
      source: SP_MENTIONS,
    },
    {
      kind: 'other',
      label: { fr: 'SIRET', en: 'SIRET' },
      example: '443 061 841 00047',
      normalize: normalizeFrDigits,
      validate: validateSiret,
      requiredOnInvoice: false,
      source: SP_MENTIONS,
    },
    {
      kind: 'vat',
      label: { fr: 'N° de TVA intracommunautaire', en: 'VAT number' },
      example: 'FR64443061841',
      normalize: normalizeFrVat,
      validate: validateFrVat,
      requiredOnInvoice: true,
      source: LEGIFRANCE_242_NONIES_A,
    },
  ],
  indirectTax: {
    kind: 'vat',
    name: { fr: 'TVA', en: 'VAT' },
    // CGI art. 278 (standard), 278-0 bis ff. (5.5 %), 279 (10 %), 281 quater ff. (2.1 %).
    // Corsica and the overseas departments have their own rates – see caveats.
    rateSets: [
      {
        validFrom: '2000-04-01',
        rates: [
          { rate: 19.6, kind: 'standard' },
          { rate: 5.5, kind: 'reduced' },
          { rate: 2.1, kind: 'super_reduced' },
        ],
      },
      {
        validFrom: '2012-01-01',
        rates: [
          { rate: 19.6, kind: 'standard' },
          { rate: 7, kind: 'reduced', appliesTo: 'restaurants, passenger transport, renovation works' },
          { rate: 5.5, kind: 'reduced', appliesTo: 'food, books, energy' },
          { rate: 2.1, kind: 'super_reduced' },
        ],
      },
      {
        validFrom: '2014-01-01',
        rates: [
          { rate: 20, kind: 'standard' },
          { rate: 10, kind: 'reduced', appliesTo: 'restaurants, passenger transport, renovation works, accommodation' },
          { rate: 5.5, kind: 'reduced', appliesTo: 'food, books, energy, energy-saving renovation' },
          { rate: 2.1, kind: 'super_reduced', appliesTo: 'reimbursable medicines, press, some live shows' },
        ],
      },
    ],
    smallBusiness: {
      // CGI art. 293 B: EUR 37,500 for services, EUR 85,000 for goods and
      // accommodation in 2026 (the single EUR 25,000 threshold planned by LF 2025
      // and PLF 2026 art. 25 was dropped). The contract has one threshold, so
      // the services one is used.
      threshold: 37_500,
      currency: 'EUR',
      invoiceNote: {
        fr: 'TVA non applicable, art. 293 B du CGI',
        en: 'VAT not applicable, art. 293 B of the French Tax Code',
      },
      source: SP_FRANCHISE,
    },
    reverseChargeNote: {
      // CGI ann. II art. 242 nonies A, I-13°: the mention "Autoliquidation".
      domestic: { fr: 'Autoliquidation', en: 'Reverse charge' },
      crossBorder: { fr: 'Autoliquidation', en: 'Reverse charge' },
    },
    source: SP_TAUX,
  },
  invoice: {
    requirements: [
      { field: 'invoice_number', rule: 'CGI ann. II art. 242 nonies A, I-7°' },
      { field: 'issue_date', rule: 'CGI ann. II art. 242 nonies A, I-6°' },
      { field: 'supply_date', rule: 'CGI ann. II art. 242 nonies A, I-9°' },
      { field: 'due_date', when: 'b2b', rule: 'Code de commerce L441-9' },
      { field: 'supplier_name', rule: 'CGI ann. II art. 242 nonies A, I-1°' },
      { field: 'supplier_address', rule: 'CGI ann. II art. 242 nonies A, I-1°' },
      { field: 'supplier_company_id', rule: 'Code de commerce R123-237 (SIREN)' },
      { field: 'supplier_vat_id', when: 'tax_registered', rule: 'CGI ann. II art. 242 nonies A, I-2°' },
      { field: 'customer_name', rule: 'CGI ann. II art. 242 nonies A, I-1°' },
      { field: 'customer_address', rule: 'CGI ann. II art. 242 nonies A, I-1°' },
      { field: 'customer_vat_id', when: 'cross_border', rule: 'CGI ann. II art. 242 nonies A, I-3°' },
      { field: 'line_description', rule: 'CGI ann. II art. 242 nonies A, I-8°' },
      { field: 'line_quantity', rule: 'CGI ann. II art. 242 nonies A, I-8°' },
      { field: 'line_unit_price', rule: 'CGI ann. II art. 242 nonies A, I-10°' },
      { field: 'tax_rate_per_line', rule: 'CGI ann. II art. 242 nonies A, I-10°' },
      { field: 'tax_amount_per_rate', rule: 'CGI ann. II art. 242 nonies A, I-11°' },
      { field: 'total_with_tax', rule: 'CGI ann. II art. 242 nonies A, I-11°' },
      { field: 'tax_in_local_currency', rule: 'Directive 2006/112/EC art. 230' },
    ],
    // CGI ann. II art. 242 nonies A, II: simplified invoices up to EUR 150 excl. VAT.
    simplifiedThreshold: { amount: 150, currency: 'EUR' },
    numbering: { gapless: true, multipleSeries: true },
    language: {
      required: ['fr'],
      note: 'An invoice in another language is valid, but the administration may require a certified French translation (CGI art. 289; BOI-TVA-DECLA-30-20-10).',
    },
    homeCurrencyTaxRequired: true,
    // Code de commerce L123-22: 10 years (tax law, LPF L102 B: 6 years).
    retentionYears: 10,
    source: LEGIFRANCE_242_NONIES_A,
  },
  einvoicing: [
    {
      // Ordonnance n° 2014-697: all public-sector suppliers since 2020.
      scope: 'b2g',
      model: 'post_audit',
      from: 'in_force',
      appliesTo: 'all suppliers of the public sector',
      formats: ['ubl', 'cii', 'facturx'],
      platform: 'Chorus Pro',
      source: { title: 'Chorus Pro', url: 'https://chorus-pro.gouv.fr' },
    },
    {
      // CGI art. 289 bis, LF 2024 art. 91.
      scope: 'b2b',
      model: 'real_time_reporting',
      from: '2026-09-01',
      appliesTo: 'every VAT-registered business must be able to receive; large companies and ETI must also issue and e-report',
      formats: ['facturx', 'ubl', 'cii'],
      platform: 'Plateformes agréées (PA) + PPF directory',
      source: IMPOTS_EINVOICING,
    },
    {
      scope: 'b2b',
      model: 'real_time_reporting',
      from: '2027-09-01',
      appliesTo: 'PME, TPE and micro-entrepreneurs must issue e-invoices through a PA',
      formats: ['facturx', 'ubl', 'cii'],
      platform: 'Plateformes agréées (PA) + PPF directory',
      source: IMPOTS_EINVOICING,
    },
    {
      // CGI art. 290: e-reporting of B2C and international sales and of payment data.
      scope: 'b2c',
      model: 'real_time_reporting',
      from: '2027-09-01',
      appliesTo: 'e-reporting of B2C sales and payment data by PME, TPE and micro-entrepreneurs (large companies and ETI from 2026-09-01)',
      formats: [],
      platform: 'Plateformes agréées (PA)',
      source: IMPOTS_EINVOICING,
    },
  ],
  payments: {
    iban: true,
    qr: ['epc'],
    reference: 'free_text',
    localMethods: ['sepa', 'card', 'wero'],
  },
  registry: {
    name: 'Annuaire des entreprises (INSEE Sirene)',
    url: 'https://annuaire-entreprises.data.gouv.fr',
    api: {
      url: 'https://recherche-entreprises.api.gouv.fr',
      auth: 'none',
      notes: 'Free, no key; already used by foreign-registries.ts. API Sirene (portail-api.insee.fr) needs a free key.',
    },
  },
  holidays: frHolidays,
  deadlines: frDeadlines,
  supportLevel: 'pack',
  verifiedAt: '2026-10-21',
  caveats: [
    'Mentions that do not fit InvoiceField: legal form and share capital, RCS/RM registration and city, "EI" or "Entrepreneur individuel" next to a sole trader name, late-payment penalty rate, the flat EUR 40 recovery fee and early-payment discount terms (Code de commerce L441-9, D441-5).',
    'Mentions mandatory with the e-invoicing reform (CGI ann. II art. 242 nonies A as amended for 2026): customer SIREN, delivery address if different, category of operation (goods / services / both) and "Option pour le paiement de la taxe d\'après les débits" when opted. They do not fit InvoiceField yet.',
    'Franchise en base 2026: EUR 37,500 services / EUR 85,000 goods and accommodation, tolerance EUR 41,250 / EUR 93,500. Confirmed by secondary sources only (PLF 2026 art. 25 rejected); re-check BOFiP each January. Higher thresholds for lawyers, authors and performers not confirmed.',
    'Corsica (CGI art. 297) and the overseas departments (CGI art. 296: 8.5 % / 2.1 %) have separate rates; the pack covers metropolitan France only.',
    'Alsace-Moselle has two extra public holidays (Good Friday, 26 December); not in frHolidays.',
    'CA3 due day depends on the business (15th–24th); frDeadlines uses the 24th. CA12 advances (July, December) are not listed.',
    'The reform is a decentralised CTC model (invoices through PAs, data extract to the PPF); the contract has no exact model value, so real_time_reporting is used. Sanctions (CGI art. 1737) are not modelled.',
    'Software recording B2C cash payments must be certified (CGI art. 286 I 3° bis); do not offer cash recording for French B2C until scoped.',
    'Alphanumeric VAT keys are validated for format only (the algorithm is not public).',
    'Dates of the e-invoicing calendar confirmed by secondary sources in October 2026; the official impots.gouv.fr page was not re-read.',
  ],
  sources: [LEGIFRANCE_242_NONIES_A, SP_MENTIONS, SP_FRANCHISE, SP_TAUX, IMPOTS_EINVOICING],
};
