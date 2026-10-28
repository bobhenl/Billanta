import type { CountryPack, Source } from '../types.js';
import { esDeadlines, esHolidays } from './calendar.js';
import { isValidEsNif, isValidEsVatId, normalizeEsNif, normalizeEsVatId } from './tax-ids.js';

const RD_1619_2012: Source = {
  title: 'RD 1619/2012, Reglamento por el que se regulan las obligaciones de facturación',
  url: 'https://www.boe.es/buscar/act.php?id=BOE-A-2012-14696',
};
const LIVA: Source = {
  title: 'Ley 37/1992 del Impuesto sobre el Valor Añadido',
  url: 'https://www.boe.es/buscar/act.php?id=BOE-A-1992-28740',
};
const IGIC: Source = {
  title: 'Ley 4/2012 de medidas administrativas y fiscales (Canarias), arts. 27–28 – tipos del IGIC',
  url: 'https://www.boe.es/buscar/act.php?id=BOE-A-2012-9554',
};
const RD_1007_2023: Source = {
  title: 'RD 1007/2023, Reglamento de sistemas informáticos de facturación (VERI*FACTU)',
  url: 'https://www.boe.es/buscar/act.php?id=BOE-A-2023-24840',
};
const RDL_15_2025: Source = {
  title: 'Real Decreto-ley 15/2025 – new VERI*FACTU application dates',
  url: 'https://sede.agenciatributaria.gob.es/Sede/iva/sistemas-informaticos-facturacion-verifactu.html',
};
const ORDEN_HAC_1028_2026: Source = {
  title: 'Orden HAC/1028/2026 – AEAT public e-invoicing solution (starts the RD 238/2026 B2B clocks)',
  url: 'https://www.boe.es/buscar/pdf/2026/BOE-A-2026-20587-consolidado.pdf',
};
const SII: Source = {
  title: 'AEAT – Suministro Inmediato de Información (RD 596/2016)',
  url: 'https://sede.agenciatributaria.gob.es/Sede/iva/suministro-inmediato-informacion.html',
};
const TICKETBAI: Source = {
  title: 'TicketBAI – Haciendas Forales de Araba, Bizkaia (Batuz) y Gipuzkoa',
  url: 'https://www.batuz.eus/',
};
const FACE: Source = {
  title: 'Ley 25/2013 de impulso de la factura electrónica (FACe, Facturae)',
  url: 'https://www.boe.es/buscar/act.php?id=BOE-A-2013-13722',
};

/**
 * Spain (common territory). VAT payers charge IVA from the first euro; there
 * is no domestic small-business exemption (LIVA art. 20 exempts activities,
 * not small turnovers), so `smallBusiness` is deliberately missing.
 */
export const ES: CountryPack = {
  code: 'ES',
  name: 'Spain',
  region: 'eu',
  euMember: true,
  currency: 'EUR',
  currencyMinorUnits: 2,
  timeZone: 'Europe/Madrid',
  locales: ['es', 'en'],
  subdivisions: [
    { code: 'ES-CN', name: 'Canarias' },
    { code: 'ES-CE', name: 'Ceuta' },
    { code: 'ES-ML', name: 'Melilla' },
    { code: 'ES-PV', name: 'País Vasco / Euskadi' },
    { code: 'ES-NC', name: 'Navarra' },
  ],
  taxIds: [
    {
      kind: 'tax',
      label: { es: 'NIF', en: 'NIF (tax ID)' },
      // Sample DNI used in AEAT and Ministerio del Interior documentation.
      example: '12345678Z',
      normalize: normalizeEsNif,
      validate: isValidEsNif,
      // RD 1619/2012 art. 6.1.d: the issuer's NIF on every full invoice.
      requiredOnInvoice: true,
      source: { title: 'RD 1065/2007 arts. 18–23 (NIF)', url: 'https://www.boe.es/buscar/act.php?id=BOE-A-2007-15984' },
    },
    {
      kind: 'vat',
      label: { es: 'NIF-IVA', en: 'EU VAT number' },
      example: 'ES12345678Z',
      normalize: normalizeEsVatId,
      validate: isValidEsVatId,
      // Only for intra-EU supplies (RD 1619/2012 art. 6.1.d, second paragraph).
      requiredOnInvoice: false,
      source: LIVA,
    },
  ],
  indirectTax: {
    kind: 'vat',
    name: { es: 'IVA', en: 'VAT' },
    rateSets: [
      {
        // LIVA arts. 90–91 as amended by RDL 20/2012, from 1 Sep 2012.
        validFrom: '2012-09-01',
        rates: [
          { rate: 21, kind: 'standard' },
          { rate: 10, kind: 'reduced', appliesTo: 'food, passenger transport, hospitality, housing (LIVA art. 91.Uno)' },
          { rate: 4, kind: 'super_reduced', appliesTo: 'bread, milk, books, medicines, protected housing (LIVA art. 91.Dos)' },
          { rate: 0, kind: 'zero', appliesTo: 'intra-EU supplies and exports (exempt with right to deduct, LIVA arts. 21 and 25)' },
        ],
      },
      {
        // The Canary Islands are outside the EU VAT area; IGIC replaces IVA
        // (Ley 20/1991, rates in Ley 4/2012 arts. 27–28, 15 % since Ley 19/2019).
        validFrom: '2020-01-01',
        subdivision: 'ES-CN',
        rates: [
          { rate: 7, kind: 'standard', appliesTo: 'IGIC tipo general' },
          { rate: 3, kind: 'reduced', appliesTo: 'IGIC tipo reducido' },
          { rate: 9.5, kind: 'standard', appliesTo: 'IGIC tipo incrementado' },
          { rate: 15, kind: 'standard', appliesTo: 'IGIC tipo incrementado (vehicles, jewellery…)' },
          { rate: 20, kind: 'standard', appliesTo: 'IGIC tipo especial (tobacco)' },
          { rate: 0, kind: 'zero', appliesTo: 'IGIC tipo cero (basic food, water, books…)' },
        ],
      },
    ],
    reverseChargeNote: {
      // RD 1619/2012 art. 6.1.m.
      domestic: { es: 'Inversión del sujeto pasivo', en: 'Reverse charge (inversión del sujeto pasivo)' },
      crossBorder: {
        es: 'Inversión del sujeto pasivo / Entrega intracomunitaria exenta (art. 25 Ley 37/1992)',
        en: 'Reverse charge / Exempt intra-EU supply (art. 25 Ley 37/1992)',
      },
    },
    source: LIVA,
  },
  invoice: {
    title: {
      standard: { es: 'Factura', en: 'Invoice' },
      simplified: { es: 'Factura simplificada', en: 'Simplified invoice' },
    },
    // RD 1619/2012 art. 6.1 (factura completa).
    requirements: [
      { field: 'invoice_number', rule: 'RD 1619/2012 art. 6.1.a (number and series)' },
      { field: 'issue_date', rule: 'RD 1619/2012 art. 6.1.b' },
      { field: 'supplier_name', rule: 'RD 1619/2012 art. 6.1.c' },
      { field: 'customer_name', rule: 'RD 1619/2012 art. 6.1.c' },
      { field: 'supplier_tax_id', rule: 'RD 1619/2012 art. 6.1.d' },
      { field: 'customer_vat_id', when: 'b2b', rule: 'RD 1619/2012 art. 6.1.d (recipient NIF)' },
      { field: 'supplier_address', rule: 'RD 1619/2012 art. 6.1.e' },
      { field: 'customer_address', when: 'b2b', rule: 'RD 1619/2012 art. 6.1.e' },
      { field: 'line_description', rule: 'RD 1619/2012 art. 6.1.f' },
      { field: 'line_unit_price', rule: 'RD 1619/2012 art. 6.1.f (unit price net of tax, discounts)' },
      { field: 'tax_rate_per_line', rule: 'RD 1619/2012 art. 6.1.g' },
      { field: 'tax_amount_per_rate', rule: 'RD 1619/2012 art. 6.1.h (cuota shown separately)' },
      { field: 'supply_date', rule: 'RD 1619/2012 art. 6.1.i (when it differs from the issue date)' },
      { field: 'tax_in_local_currency', rule: 'RD 1619/2012 art. 10.1 (cuota in euros)' },
    ],
    // RD 1619/2012 art. 4.1: 400 EUR incl. VAT; 3,000 EUR for retail and the
    // sectors listed in art. 4.1 (not modelled here).
    simplifiedThreshold: { amount: 400, currency: 'EUR' },
    numbering: {
      // Art. 6.1.a: correlative within a series; separate series mandatory
      // for rectificativas (art. 6.1.a, third paragraph).
      gapless: true,
      multipleSeries: true,
      seriesRegistration: false,
    },
    // Art. 12.1: any language; AEAT may ask for a translation (art. 12.2).
    language: { note: 'Any language; AEAT can require a Spanish translation (RD 1619/2012 art. 12).' },
    homeCurrencyTaxRequired: true,
    // RD 1619/2012 art. 19 via LGT art. 66 (prescription, 4 years).
    retentionYears: 4,
    source: RD_1619_2012,
  },
  einvoicing: [
    {
      scope: 'b2g',
      model: 'post_audit',
      from: 'in_force',
      appliesTo: 'suppliers of public administrations (since 15 Jan 2015)',
      formats: ['facturae'],
      platform: 'FACe',
      source: FACE,
    },
    {
      scope: 'b2b',
      model: 'real_time_reporting',
      from: 'in_force',
      appliesTo: 'turnover > EUR 6,000,000, VAT groups and REDEME (monthly refund) registrants',
      formats: ['sii_xml'],
      platform: 'SII',
      source: SII,
    },
    {
      scope: 'b2b',
      model: 'real_time_reporting',
      from: 'in_force',
      appliesTo: 'taxpayers under the Basque foral regimes (Araba, Bizkaia via Batuz, Gipuzkoa); all invoices incl. B2C',
      formats: ['ticketbai_xml'],
      platform: 'TicketBAI',
      source: TICKETBAI,
    },
    {
      scope: 'b2b',
      model: 'real_time_reporting',
      from: '2027-01-01',
      appliesTo:
        'corporate income tax (IS) payers not on SII – all invoices incl. B2C; software producers already bound since 29 Jul 2025',
      formats: ['verifactu_xml'],
      platform: 'VERI*FACTU (AEAT)',
      source: RDL_15_2025,
    },
    {
      scope: 'b2b',
      model: 'real_time_reporting',
      from: '2027-07-01',
      appliesTo: 'all other IRPF/IRNR taxpayers incl. autónomos – all invoices incl. B2C',
      formats: ['verifactu_xml'],
      platform: 'VERI*FACTU (AEAT)',
      source: RD_1007_2023,
    },
    {
      scope: 'b2b',
      model: 'peppol_exchange',
      from: '2027-10-06',
      appliesTo: 'businesses with turnover > EUR 8,000,000 (RD 238/2026, 12 months after Orden HAC/1028/2026)',
      formats: ['ubl', 'cii', 'edifact', 'facturae'],
      platform: 'Private interoperable platforms or the AEAT public solution',
      source: ORDEN_HAC_1028_2026,
    },
    {
      scope: 'b2b',
      model: 'peppol_exchange',
      from: '2028-10-06',
      appliesTo: 'all other businesses and autónomos (RD 238/2026, 24 months after Orden HAC/1028/2026)',
      formats: ['ubl', 'cii', 'edifact', 'facturae'],
      platform: 'Private interoperable platforms or the AEAT public solution',
      source: ORDEN_HAC_1028_2026,
    },
  ],
  payments: {
    iban: true,
    // EPC QR is read by few Spanish banking apps, so no QR by default.
    reference: 'free_text',
    localMethods: ['sepa', 'sepa_direct_debit', 'bizum', 'card'],
  },
  registry: {
    name: 'Registro Mercantil Central (BORME)',
    url: 'https://www.rmc.es/',
  },
  holidays: esHolidays,
  deadlines: esDeadlines,
  supportLevel: 'pack',
  verifiedAt: '2026-10-21',
  caveats: [
    'VERI*FACTU: on 5 Oct 2026 Hacienda announced a move of the user deadlines to October 2028; not in the BOE as of 21 Oct 2026, so the RDL 15/2025 dates (1 Jan 2027 / 1 Jul 2027) are kept. Software producers are bound since 29 Jul 2025 regardless.',
    'VERI*FACTU applies to every invoice, but `EInvoiceMandate.scope` takes one value, so the entries are filed under b2b with B2C noted in appliesTo.',
    'RD 238/2026 B2B dates are derived from Orden HAC/1028/2026 entering into force on 6 Oct 2026 (secondary sources and AEAT news); the "peppol_exchange" model is the closest fit – Spain uses interoperable platforms, not necessarily Peppol, plus a UBL copy to AEAT.',
    'IGIC (Canary Islands) is a separate tax, not IVA; the pack models it as a subdivision rate set. IGIC 9.5 % / 15 % / 20 % are "incrementado" and "especial" rates with no matching TaxRate kind, filed as standard. IGIC history before 2020 is not modelled.',
    'Ceuta and Melilla levy IPSI (rates set by each city) instead of IVA – not modelled.',
    'Temporary IVA cuts on staples (0 % / 2 % / 5 % in 2023–2024) and on energy are not in the rate history.',
    'Recargo de equivalencia (5.2 / 1.4 / 0.5 %, LIVA art. 161) charged to retailers is not modelled.',
    'IRPF withholding on professional invoices (15 %, 7 % for the first three years, RIRPF art. 95 and 101) is not representable in the contract.',
    'Simplified invoice threshold is 3,000 EUR for retail and the sectors of RD 1619/2012 art. 4.1; only the general 400 EUR is in the pack.',
    'Retention: 4 years under the LGT; the Código de Comercio art. 30 requires 6 years for accounting records.',
    'Holidays are national only; regional days (incl. Holy Thursday in most regions) and Sunday-to-Monday moves are set per region each year. Deadlines move for national holidays only.',
    'TicketBAI: in force in all three Basque provinces by 2026 per secondary sources; exact per-province dates were not re-checked. Navarre has its own rules, not modelled.',
    'Factura rectificativa (RD 1619/2012 art. 15) replaces credit notes and needs its own series – the contract has no field for document types.',
    'The Canary Islands are in the Atlantic/Canary time zone.',
  ],
  sources: [RD_1619_2012, LIVA, IGIC, RD_1007_2023, RDL_15_2025, ORDEN_HAC_1028_2026, SII, TICKETBAI, FACE],
};
