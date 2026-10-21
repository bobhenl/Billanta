import type { CountryPack, Source } from '../types.js';
import { italyDeadlines, italyHolidays } from './calendar.js';
import {
  isValidItCodiceFiscale,
  isValidItPartitaIva,
  normalizeItCodiceFiscale,
  normalizeItVat,
} from './tax-ids.js';

export * from './calendar.js';
export * from './tax-ids.js';

const DPR_633: Source = {
  title: 'DPR 26 ottobre 1972, n. 633 (IVA) – Normattiva',
  url: 'https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:decreto.presidente.repubblica:1972-10-26;633',
};
const FATTURAPA: Source = {
  title: 'Fatturazione elettronica – specifiche tecniche FatturaPA (Agenzia delle Entrate)',
  url: 'https://www.agenziaentrate.gov.it/portale/web/guest/schede/comunicazioni/fatture-e-corrispettivi/faq-fe/specifiche-tecniche-fe',
};
const FORFETTARIO: Source = {
  title: 'Regime forfetario – Agenzia delle Entrate (L. 190/2014, art. 1 c. 54–89)',
  url: 'https://www.agenziaentrate.gov.it/portale/web/guest/schede/agevolazioni/regime-forfetario-2023',
};
const BOLLO: Source = {
  title: 'Imposta di bollo sulle fatture elettroniche – Agenzia delle Entrate',
  url: 'https://www.agenziaentrate.gov.it/portale/web/guest/schede/pagamenti/imposta-di-bollo-sulle-fatture-elettroniche',
};
const SPLIT_PAYMENT: Source = {
  title: 'Split payment – Agenzia delle Entrate (art. 17-ter DPR 633/1972)',
  url: 'https://www.agenziaentrate.gov.it/portale/web/guest/schede/agevolazioni/split-payment',
};
const SCADENZARIO: Source = {
  title: 'Scadenzario – Agenzia delle Entrate',
  url: 'https://www.agenziaentrate.gov.it/portale/web/guest/scadenzario',
};
const LIPE: Source = {
  title: 'Comunicazioni liquidazioni periodiche IVA – Agenzia delle Entrate',
  url: 'https://www.agenziaentrate.gov.it/portale/web/guest/schede/comunicazioni/comunicazioni-liquidazioni-periodiche-iva',
};
const SAN_FRANCESCO: Source = {
  title: 'L. 8 ottobre 2025, n. 151 – 4 ottobre festa nazionale dal 2026 (Fiscal Focus)',
  url: 'https://www.fiscal-focus.it/quotidiano/il-quotidiano/articoli-lavoro/istituita-la-festa-nazionale-di-san-francesco-d-assisi-il-4-ottobre-diventa-giorno-festivo-dal-2026,3,178265',
};

/**
 * Stamp duty (imposta di bollo) on invoices: EUR 2 when the invoice carries
 * amounts not subject to VAT above EUR 77.47 – forfettari, exempt (N4) and
 * out-of-scope supplies. Not due on invoices carrying only VAT-able amounts,
 * nor on non-taxable exports and intra-EU supplies (N3.x, art. 15 Tariffa
 * DPR 642/1972 exemption). DPR 642/1972, Tariffa parte I art. 13 n. 1;
 * e-invoices pay it virtually (DatiBollo/BolloVirtuale = SI) under DM 17
 * June 2014 art. 6.
 */
export const IT_STAMP_DUTY = { amount: 2, threshold: 77.47, currency: 'EUR', source: BOLLO } as const;

export function italyStampDutyDue(amountOutsideVat: number): boolean {
  return amountOutsideVat > IT_STAMP_DUTY.threshold;
}

/** Notes for split payment (scissione dei pagamenti), shown on invoices to public bodies and FTSE MIB companies. */
export const IT_SPLIT_PAYMENT_NOTE = {
  it: 'Scissione dei pagamenti – art. 17-ter DPR 633/1972',
  en: 'Split payment – VAT paid by the customer to the State (art. 17-ter DPR 633/1972)',
} as const;

export const IT: CountryPack = {
  code: 'IT',
  name: 'Italy',
  region: 'eu',
  euMember: true,
  currency: 'EUR',
  currencyMinorUnits: 2,
  timeZone: 'Europe/Rome',
  locales: ['it', 'en'],
  taxIds: [
    {
      kind: 'vat',
      label: { it: 'Partita IVA', en: 'VAT number (Partita IVA)' },
      // Partita IVA of Eni S.p.A., published on its website and in VIES.
      example: 'IT00905811006',
      normalize: normalizeItVat,
      validate: isValidItPartitaIva,
      // Art. 21 c. 2 lett. d DPR 633/1972.
      requiredOnInvoice: true,
      source: DPR_633,
    },
    {
      kind: 'tax',
      label: { it: 'Codice fiscale', en: 'Tax code (codice fiscale)' },
      // The fictitious "Mario Rossi" code used in Agenzia and school examples.
      example: 'RSSMRA85T10A562S',
      normalize: normalizeItCodiceFiscale,
      validate: isValidItCodiceFiscale,
      // The buyer's codice fiscale replaces the P.IVA for consumers (art. 21 c. 2 lett. f).
      requiredOnInvoice: false,
      source: {
        title: 'Codice fiscale – Agenzia delle Entrate',
        url: 'https://www.agenziaentrate.gov.it/portale/web/guest/schede/istanze/richiesta-ts_cf/informazioni-codificazione-pf',
      },
    },
  ],
  indirectTax: {
    kind: 'vat',
    name: { it: 'IVA', en: 'VAT' },
    rateSets: [
      // Standard rate 22 % from 1 October 2013 (DL 76/2013 art. 11).
      {
        validFrom: '2013-10-01',
        rates: [
          { rate: 22, kind: 'standard' },
          { rate: 10, kind: 'reduced', appliesTo: 'Tabella A parte III: food, hotels and restaurants, building renovation, energy for households' },
          { rate: 4, kind: 'super_reduced', appliesTo: 'Tabella A parte II: basic food, books and newspapers, first homes, aids for disabled people' },
        ],
      },
      // The 5 % rate was added by L. 208/2015 (Tabella A parte II-bis) from 1 January 2016.
      {
        validFrom: '2016-01-01',
        rates: [
          { rate: 22, kind: 'standard' },
          { rate: 10, kind: 'reduced', appliesTo: 'Tabella A parte III: food, hotels and restaurants, building renovation, energy for households' },
          { rate: 5, kind: 'reduced', appliesTo: 'Tabella A parte II-bis: social-cooperative services, some foods (e.g. herbs), feminine hygiene and baby products' },
          { rate: 4, kind: 'super_reduced', appliesTo: 'Tabella A parte II: basic food, books and newspapers, first homes, aids for disabled people' },
        ],
      },
    ],
    smallBusiness: {
      // Regime forfettario: revenue up to EUR 85,000 (L. 190/2014 art. 1 c. 54
      // as amended by L. 197/2022); above EUR 100,000 the regime ends at once.
      threshold: 85000,
      currency: 'EUR',
      invoiceNote: {
        it: "Operazione effettuata ai sensi dell'art. 1, commi da 54 a 89, della Legge n. 190/2014 – regime forfettario. Operazione senza applicazione dell'IVA e non soggetta a ritenuta d'acconto ai sensi dell'art. 1, comma 67, L. 190/2014.",
        en: 'Supply under the flat-rate scheme, art. 1 paragraphs 54–89 of Law 190/2014: no VAT charged and no withholding tax (art. 1 paragraph 67, Law 190/2014).',
      },
      source: FORFETTARIO,
    },
    reverseChargeNote: {
      // Art. 17 c. 5–6 DPR 633/1972; FatturaPA Natura N6.1–N6.9, the buyer integrates with TD16.
      domestic: {
        it: 'Inversione contabile – art. 17, comma 6, DPR 633/1972',
        en: 'Reverse charge – art. 17(6) DPR 633/1972',
      },
      // Art. 7-ter (services, Natura N2.1) and art. 41 DL 331/1993 (intra-EU goods, N3.2).
      crossBorder: {
        it: 'Inversione contabile – operazione non soggetta ai sensi dell\'art. 7-ter DPR 633/1972 / non imponibile ai sensi dell\'art. 41 DL 331/1993',
        en: 'Reverse charge – art. 196 Directive 2006/112/EC',
      },
    },
    source: DPR_633,
  },
  invoice: {
    // Art. 21 c. 2 DPR 633/1972 (full invoice); art. 21-bis for the simplified one.
    requirements: [
      { field: 'issue_date', rule: 'art. 21 c. 2 lett. a DPR 633/1972' },
      { field: 'invoice_number', rule: 'art. 21 c. 2 lett. b DPR 633/1972' },
      { field: 'supplier_name', rule: 'art. 21 c. 2 lett. c DPR 633/1972' },
      { field: 'supplier_address', rule: 'art. 21 c. 2 lett. c DPR 633/1972' },
      { field: 'supplier_vat_id', rule: 'art. 21 c. 2 lett. d DPR 633/1972' },
      { field: 'customer_name', rule: 'art. 21 c. 2 lett. e DPR 633/1972' },
      { field: 'customer_address', rule: 'art. 21 c. 2 lett. e DPR 633/1972' },
      { field: 'customer_vat_id', when: 'b2b', rule: 'art. 21 c. 2 lett. f DPR 633/1972 (codice fiscale for consumers)' },
      { field: 'line_description', rule: 'art. 21 c. 2 lett. g DPR 633/1972' },
      { field: 'line_quantity', rule: 'art. 21 c. 2 lett. g DPR 633/1972' },
      { field: 'line_unit_price', rule: 'art. 21 c. 2 lett. h DPR 633/1972' },
      { field: 'tax_rate_per_line', rule: 'art. 21 c. 2 lett. l DPR 633/1972' },
      { field: 'tax_amount_per_rate', rule: 'art. 21 c. 2 lett. l DPR 633/1972' },
      { field: 'supply_date', rule: 'art. 21 c. 2 lett. g-bis DPR 633/1972 (when it differs from the issue date)' },
      { field: 'tax_in_local_currency', rule: 'art. 21 c. 2 lett. l and art. 13 c. 4 DPR 633/1972' },
    ],
    // Art. 21-bis DPR 633/1972 and DM 10 May 2019: simplified invoice up to EUR 400.
    simplifiedThreshold: { amount: 400, currency: 'EUR' },
    numbering: {
      // Art. 21 c. 2 lett. b: a progressive number that identifies the invoice uniquely; series allowed (Ris. 1/E 2013).
      gapless: true,
      multipleSeries: true,
    },
    homeCurrencyTaxRequired: true,
    // Art. 2220 codice civile and art. 39 DPR 633/1972; e-invoices in conservazione digitale (DMEF 17 June 2014).
    retentionYears: 10,
    source: DPR_633,
  },
  einvoicing: [
    {
      scope: 'b2g',
      model: 'clearance',
      // L. 244/2007 art. 1 c. 209–214: central administrations from 6 June 2014, all from 31 March 2015.
      from: 'in_force',
      formats: ['fatturapa'],
      platform: 'SdI',
      appliesTo: 'all suppliers invoicing public administration (FPA12, qualified signature)',
      source: FATTURAPA,
    },
    {
      scope: 'b2b',
      model: 'clearance',
      // D.Lgs. 127/2015 art. 1 c. 3 as amended by L. 205/2017; forfettari since 1 January 2024 (DL 36/2022 art. 18).
      from: 'in_force',
      formats: ['fatturapa'],
      platform: 'SdI',
      appliesTo: 'all resident and established taxpayers, forfettari included since 2024-01-01',
      source: FATTURAPA,
    },
    {
      scope: 'b2c',
      model: 'clearance',
      // Same rule; the consumer copy lands in their Agenzia reserved area, with a courtesy PDF.
      from: 'in_force',
      formats: ['fatturapa'],
      platform: 'SdI',
      appliesTo: 'all resident taxpayers (healthcare data to Sistema Tessera Sanitaria is excluded)',
      source: FATTURAPA,
    },
  ],
  payments: {
    iban: true,
    qr: ['epc'],
    reference: 'free_text',
    localMethods: ['sepa', 'riba', 'sepa_dd', 'card', 'paypal', 'satispay'],
  },
  registry: {
    name: 'Registro Imprese (InfoCamere)',
    url: 'https://www.registroimprese.it/',
  },
  holidays: italyHolidays,
  deadlines: italyDeadlines,
  supportLevel: 'pack',
  verifiedAt: '2026-10-21',
  caveats: [
    'Stamp duty (EUR 2 above EUR 77.47 outside VAT), split payment, ritenuta d\'acconto (20 %) and cassa previdenziale / rivalsa INPS 4 % have no place in the CountryPack contract; they are exported as IT_STAMP_DUTY / italyStampDutyDue / IT_SPLIT_PAYMENT_NOTE and need a contract field or an IT-specific invoice extension.',
    'An invoice exists only once SdI accepts it: Billanta needs a FatturaPA 1.2.x (spec v1.9) generator and an SdI provider before IT can reach supportLevel "invoicing".',
    'Small bollo amounts may be paid later (Q1 below EUR 5,000 with Q2; Q1+Q2 below EUR 5,000 with Q3) – the calendar shows the standard quarterly dates only.',
    'Quarterly VAT filing is open to turnover up to EUR 800,000 (services and goods alike since 2025); confirm the limit each year.',
    'Forfettario: the EUR 85,000 limit was confirmed unchanged for 2026 by secondary sources (L. 199/2025); confirm in the Agenzia guide.',
    '4 October is a holiday from 2026 under L. 151/2025; the President asked Parliament to reconcile it with the civil solemnity of St Catherine on the same day – watch for an amendment.',
    'Holiday-shifted deadlines only check Italian national holidays of the same year; a deadline pushed past 31 December is not handled.',
    'The reverse-charge wording is the common practice; the precise Natura code (N6.x, N2.1, N3.2) is what SdI checks – have a commercialista confirm the note text.',
    'Gapless numbering: Italian law requires progressive unique numbers; gaps from cancelled invoices must be justified – confirm how Billanta handles SdI rejections (resend with the same number within 5 days).',
  ],
  sources: [DPR_633, FATTURAPA, FORFETTARIO, BOLLO, SPLIT_PAYMENT, SCADENZARIO, LIPE, SAN_FRANCESCO],
};
