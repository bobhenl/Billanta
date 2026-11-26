import type { CountryPack, Source } from '../types.js';
import { ptDeadlines, ptHolidays } from './calendar.js';
import { isValidPtNif, isValidPtNipc, isValidPtVatId, normalizePtNif, normalizePtVatId } from './tax-ids.js';

const CIVA: Source = {
  title: 'Código do IVA (CIVA)',
  url: 'https://info.portaldasfinancas.gov.pt/pt/informacao_fiscal/codigos_tributarios/civa_rep/Pages/codigo-do-iva-indice.aspx',
};
const DL_28_2019: Source = {
  title: 'Decreto-Lei 28/2019 – processamento de faturas, ATCUD, software certificado',
  url: 'https://diariodarepublica.pt/dr/detalhe/decreto-lei/28-2019-119622094',
};
const CERTIFICATION: Source = {
  title: 'Portaria 363/2010 – certificação prévia de programas de faturação (AT)',
  url: 'https://info.portaldasfinancas.gov.pt/pt/apoio_contribuinte/certificacao_software/Pages/certificacao-software.aspx',
};
const AT_NEWSLETTER_2026: Source = {
  title: 'AT Newsletter 39 (Jan 2026) – regime de isenção do art. 53.º CIVA',
  url: 'https://info.portaldasfinancas.gov.pt/pt/at/Divulgacao/publicacoes_internas/Newsletter_AT/Documents/Newsletter-39-janeiro-2026.pdf',
};
const B2G: Source = {
  title: 'Decreto-Lei 111-B/2017 – faturação eletrónica nos contratos públicos (CIUS-PT)',
  url: 'https://diariodarepublica.pt/dr/detalhe/decreto-lei/111-b-2017-108086622',
};
const PDF_QES: Source = {
  title: 'Lei 73-A/2025 (OE2026) art. 95 – PDF invoices accepted as electronic until 31 Dec 2026',
  url: 'https://invoicexpress.com/blog/assinatura-digital-nas-faturas-adiada-para-2027/',
};

/**
 * Portugal. Invoices may only come from AT-certified software (or the free
 * Portal das Finanças), every series is communicated to AT first and every
 * document carries ATCUD, a QR code and four characters of its signature
 * hash. Rates depend on where the supply is taxed: mainland, Azores or
 * Madeira (CIVA art. 18.º and the regional decrees).
 */
export const PT: CountryPack = {
  code: 'PT',
  name: 'Portugal',
  region: 'eu',
  euMember: true,
  currency: 'EUR',
  currencyMinorUnits: 2,
  timeZone: 'Europe/Lisbon',
  locales: ['pt-PT', 'en'],
  subdivisions: [
    { code: 'PT-20', name: 'Região Autónoma dos Açores' },
    { code: 'PT-30', name: 'Região Autónoma da Madeira' },
  ],
  taxIds: [
    {
      kind: 'tax',
      label: { pt: 'NIF', en: 'NIF (tax ID)' },
      // The canonical sample number; passes the mod 11 rule.
      example: '123456789',
      normalize: normalizePtNif,
      validate: isValidPtNif,
      // CIVA art. 36.º n.º 5 a): supplier and buyer NIF.
      requiredOnInvoice: true,
      source: CIVA,
    },
    {
      kind: 'company',
      label: { pt: 'NIPC', en: 'NIPC (company tax ID)' },
      // Constructed sample (first digit 5 = legal person, check digit 0).
      example: '500000000',
      normalize: normalizePtNif,
      validate: isValidPtNipc,
      requiredOnInvoice: false,
      source: CIVA,
    },
    {
      kind: 'vat',
      label: { pt: 'NIF-IVA', en: 'EU VAT number' },
      example: 'PT123456789',
      normalize: normalizePtVatId,
      validate: isValidPtVatId,
      requiredOnInvoice: false,
      source: CIVA,
    },
  ],
  indirectTax: {
    kind: 'vat',
    name: { pt: 'IVA', en: 'VAT' },
    rateSets: [
      {
        // CIVA art. 18.º n.º 1, 23 % / 13 % / 6 % since Lei 55-A/2010 (OE2011).
        validFrom: '2011-01-01',
        rates: [
          { rate: 23, kind: 'standard' },
          { rate: 13, kind: 'reduced', appliesTo: 'intermediate rate – CIVA Lista II (restaurants, some food, wine…)' },
          { rate: 6, kind: 'super_reduced', appliesTo: 'reduced rate – CIVA Lista I (basic food, books, medicines, hotels…)' },
          { rate: 0, kind: 'zero', appliesTo: 'intra-EU supplies and exports (exempt with right to deduct, RITI art. 14.º, CIVA art. 14.º)' },
        ],
      },
      {
        // Madeira: 22 / 12 / 5 % from 1 Apr 2012 (regional adjustment of 2012).
        validFrom: '2012-04-01',
        subdivision: 'PT-30',
        rates: [
          { rate: 22, kind: 'standard' },
          { rate: 12, kind: 'reduced' },
          { rate: 5, kind: 'super_reduced' },
        ],
      },
      {
        // Madeira reduced rate cut to 4 % from 1 Oct 2024 (Madeira regional budget 2024).
        validFrom: '2024-10-01',
        subdivision: 'PT-30',
        rates: [
          { rate: 22, kind: 'standard' },
          { rate: 12, kind: 'reduced' },
          { rate: 4, kind: 'super_reduced' },
        ],
      },
      {
        // Azores: 30 % below the mainland rates from 1 Jul 2021 (regional rates under CIVA art. 18.º n.º 3).
        validFrom: '2021-07-01',
        subdivision: 'PT-20',
        rates: [
          { rate: 16, kind: 'standard' },
          { rate: 9, kind: 'reduced' },
          { rate: 4, kind: 'super_reduced' },
        ],
      },
    ],
    smallBusiness: {
      // CIVA art. 53.º as amended by DL 35/2024 (from 1 Jan 2025): turnover in
      // the previous year up to EUR 15,000; leaves the regime above EUR 18,750.
      threshold: 15000,
      currency: 'EUR',
      // CIVA art. 57.º: exempt suppliers state the legal basis.
      invoiceNote: { pt: 'IVA – regime de isenção [art. 53.º do CIVA]', en: 'VAT exempt – small business scheme (art. 53 CIVA)' },
      source: AT_NEWSLETTER_2026,
    },
    reverseChargeNote: {
      // CIVA art. 36.º n.º 13: "IVA – autoliquidação" when the buyer pays the tax.
      domestic: { pt: 'IVA – autoliquidação', en: 'VAT – reverse charge (autoliquidação)' },
      crossBorder: { pt: 'IVA – autoliquidação', en: 'VAT – reverse charge (autoliquidação)' },
    },
    source: CIVA,
  },
  invoice: {
    title: {
      // DL 28/2019 and the SAF-T document types FT / FS.
      standard: { pt: 'Fatura', en: 'Invoice' },
      simplified: { pt: 'Fatura simplificada', en: 'Simplified invoice' },
    },
    requirements: [
      { field: 'document_title', rule: 'DL 28/2019 art. 7.º (document type)' },
      { field: 'invoice_number', rule: 'CIVA art. 36.º n.º 5 + DL 28/2019 art. 7.º (series, number, ATCUD)' },
      { field: 'issue_date', rule: 'CIVA art. 36.º n.º 5' },
      { field: 'supplier_name', rule: 'CIVA art. 36.º n.º 5 a)' },
      { field: 'supplier_address', rule: 'CIVA art. 36.º n.º 5 a)' },
      { field: 'supplier_tax_id', rule: 'CIVA art. 36.º n.º 5 a)' },
      { field: 'customer_name', when: 'b2b', rule: 'CIVA art. 36.º n.º 5 a)' },
      { field: 'customer_address', when: 'b2b', rule: 'CIVA art. 36.º n.º 5 a)' },
      { field: 'customer_vat_id', when: 'b2b', rule: 'CIVA art. 36.º n.º 5 a) (buyer NIF; for consumers on request)' },
      { field: 'line_description', rule: 'CIVA art. 36.º n.º 5 b)' },
      { field: 'line_quantity', rule: 'CIVA art. 36.º n.º 5 b)' },
      { field: 'line_unit_price', rule: 'CIVA art. 36.º n.º 5 c) (price net of tax)' },
      { field: 'tax_rate_per_line', rule: 'CIVA art. 36.º n.º 5 d)' },
      { field: 'tax_amount_per_rate', rule: 'CIVA art. 36.º n.º 5 d)' },
      { field: 'supply_date', rule: 'CIVA art. 36.º n.º 5 f) (when it differs from the issue date)' },
    ],
    // CIVA art. 40.º: simplified invoices up to EUR 100 for any taxable
    // buyer, up to EUR 1,000 for retail sales to consumers.
    simplifiedThreshold: { amount: 100, currency: 'EUR' },
    numbering: {
      gapless: true,
      multipleSeries: true,
      // DL 28/2019 art. 35.º + Portaria 195/2020: every series is communicated
      // to AT before use and gets a validation code that forms the ATCUD.
      seriesRegistration: true,
    },
    language: { required: ['pt'], note: 'Portuguese (CIVA art. 36.º n.º 1); bilingual invoices are common.' },
    homeCurrencyTaxRequired: true,
    // CIVA art. 52.º: 10 years.
    retentionYears: 10,
    source: DL_28_2019,
  },
  einvoicing: [
    {
      scope: 'b2b',
      model: 'post_audit',
      from: 'in_force',
      appliesTo:
        'every issuer above the art. 53.º exemption – invoices only from AT-certified software (RSA signature chain, ATCUD, QR) or the Portal das Finanças; covers B2C too',
      formats: ['saf_t_pt'],
      platform: 'AT software certification',
      source: CERTIFICATION,
    },
    {
      scope: 'b2b',
      model: 'real_time_reporting',
      from: 'in_force',
      appliesTo: 'all issuers – monthly communication of every invoice to AT (SAF-T upload or web service); covers B2C too',
      formats: ['saf_t_pt'],
      platform: 'e-fatura',
      source: DL_28_2019,
    },
    {
      scope: 'b2g',
      model: 'peppol_exchange',
      from: 'in_force',
      appliesTo: 'large companies',
      formats: ['cius_pt'],
      platform: 'Accredited e-invoicing platforms (eSPap, Saphety…)',
      source: B2G,
    },
    {
      scope: 'b2g',
      model: 'peppol_exchange',
      from: '2027-01-01',
      appliesTo: 'micro, small and medium enterprises',
      formats: ['cius_pt'],
      platform: 'Accredited e-invoicing platforms (eSPap, Saphety…)',
      source: B2G,
    },
    {
      scope: 'b2b',
      model: 'post_audit',
      from: '2027-01-01',
      appliesTo: 'PDF invoices count as electronic only with a qualified e-signature or e-seal (or EDI)',
      formats: ['pdf_qes', 'cius_pt'],
      source: PDF_QES,
    },
  ],
  payments: {
    iban: true,
    reference: 'free_text',
    localMethods: ['sepa', 'multibanco', 'mb_way', 'card'],
  },
  registry: {
    name: 'Certidão Permanente (Registo Comercial)',
    url: 'https://www.registo.justica.gov.pt/',
  },
  holidays: ptHolidays,
  deadlines: ptDeadlines,
  supportLevel: 'pack',
  verifiedAt: '2026-10-21',
  caveats: [
    'AT certification is a launch blocker: the producer needs a Portuguese NIF, an RSA key pair, SAF-T (PT) export and a months-long AT review before any real invoice.',
    'ATCUD / series registration is a flag only; the contract has no field for the AT validation code, the QR payload or the "Processado por programa certificado n.º" notice.',
    'PDF + qualified signature from 1 Jan 2027 per OE2026; the OE2027 proposal reportedly extends PDF acceptance to 31 Dec 2027 – not law as of 21 Oct 2026.',
    'B2G for SMEs from 1 Jan 2027 after repeated postponements – confirm against OE2027.',
    'e-fatura monthly communication deadline: sources disagree between the 5th and the 12th of the following month, so no deadline entry is generated.',
    'Monthly IVA regime (turnover ≥ EUR 650,000) deadlines are not generated; only the quarterly regime.',
    'Simplified invoices: EUR 1,000 limit for retail to consumers (CIVA art. 40.º) is not modelled; only the general EUR 100.',
    'The art. 53.º invoice note wording follows common practice and the AT exemption-code table (M10); confirm with a Portuguese accountant.',
    'The art. 36.º n.º 1 Portuguese-language requirement and art. 36.º home-currency rule were not re-checked against the current CIVA text.',
    'Madeira and Azores rate history before the listed dates (and the Madeira reference law for the 2024 cut) were taken from secondary sources.',
    'IRS withholding (retenção na fonte) on category B invoices (23 % / 11.5 %) is not representable in the contract.',
    'SAF-T (PT) accounting file submission is postponed to 2028 for 2027 periods – not an invoicing mandate, not modelled.',
    'Azores use the Atlantic/Azores time zone; regional holidays of Azores and Madeira are not included.',
  ],
  sources: [CIVA, DL_28_2019, CERTIFICATION, AT_NEWSLETTER_2026, B2G, PDF_QES],
};
