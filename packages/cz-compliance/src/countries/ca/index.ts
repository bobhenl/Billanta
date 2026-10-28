import type { CountryPack, InvoiceField, Source } from '../types.js';
import { caFederalDeadlines, caFederalHolidays } from './dates.js';
import { normalizeCaId, validateBusinessNumber, validateProgramAccount, validateQstNumber } from './tax-ids.js';

export { caFederalDeadlines, caFederalHolidays, nextCaBusinessDay } from './dates.js';
export { luhnValid, normalizeCaId, validateBusinessNumber, validateProgramAccount, validateQstNumber } from './tax-ids.js';

const SRC = {
  rates: {
    title: 'CRA – GST/HST rates by province',
    url: 'https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/gst-hst-businesses/charge-collect-which-rate/calculator.html',
  },
  itcRegs: {
    title: 'Input Tax Credit Information (GST/HST) Regulations, SOR/91-45, s. 3',
    url: 'https://laws-lois.justice.gc.ca/eng/regulations/SOR-91-45/section-3.html',
  },
  smallSupplier: {
    title: 'CRA – Small supplier (Excise Tax Act s. 148)',
    url: 'https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/gst-hst-businesses/register-gst-hst/register.html',
  },
  bn: {
    title: 'CRA – Business number and program accounts',
    url: 'https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/registering-your-business/you-need-a-business-number-a-program-account.html',
  },
  qst: {
    title: 'Revenu Québec – QST and GST/HST',
    url: 'https://www.revenuquebec.ca/en/businesses/consumption-taxes/gsthst-and-qst/',
  },
  bc: { title: 'BC – Provincial sales tax', url: 'https://www2.gov.bc.ca/gov/content/taxes/sales-taxes/pst' },
  sk: { title: 'Saskatchewan – Provincial sales tax', url: 'https://www.saskatchewan.ca/business/taxes-licensing-and-reporting/provincial-taxes-policies-and-bulletins/provincial-sales-tax' },
  mb: { title: 'Manitoba – Retail sales tax', url: 'https://www.gov.mb.ca/finance/taxation/taxes/retail.html' },
  frenchCharter: {
    title: 'Charter of the French Language, s. 57 (CQLR c. C-11)',
    url: 'https://www.legisquebec.gouv.qc.ca/en/document/cs/C-11',
  },
  records: {
    title: 'CRA – Keeping records (six years)',
    url: 'https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/keeping-records/where-keep-your-records-long-request-permission-destroy-them-early.html',
  },
  holidays: {
    title: 'Canada Labour Code, s. 166 (general holidays)',
    url: 'https://laws-lois.justice.gc.ca/eng/acts/L-2/section-166.html',
  },
  gstFiling: {
    title: 'CRA – When to file your GST/HST return',
    url: 'https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/gst-hst-businesses/file-gst-hst-return/when-file-gst-hst-return.html',
  },
  payments: {
    title: 'Payments Canada – Routing numbers (transit + institution)',
    url: 'https://www.payments.ca/our-directories/financial-institutions-routing-numbers',
  },
  registry: {
    title: 'Corporations Canada – federal corporation search',
    url: 'https://ised-isde.canada.ca/cc/lgcy/fdrlCrpSrch.html',
  },
} satisfies Record<string, Source>;

/**
 * Invoice content tiers of SOR/91-45 s. 3 (what the buyer needs to claim an
 * input tax credit), by the total including tax. Raised from CAD 30 / 150 to
 * CAD 100 / 500 in 2021; older guides still show the old amounts.
 */
export const CA_INVOICE_TIERS = { registrationNumber: 100, recipientAndTerms: 500 } as const;

/**
 * Fields the invoice must show for the buyer's input tax credit at a given
 * total (incl. tax). `payment_terms` has no `InvoiceField` yet, so it is
 * reported separately.
 */
export function caInvoiceFields(totalWithTax: number): { fields: InvoiceField[]; paymentTerms: boolean } {
  // s. 3(a): always.
  const fields: InvoiceField[] = ['supplier_name', 'issue_date', 'total_with_tax'];
  // s. 3(b): CAD 100 or more – registration number, tax amount (or "tax
  // included" + rate), status of each taxable supply.
  if (totalWithTax >= CA_INVOICE_TIERS.registrationNumber) fields.push('supplier_vat_id', 'tax_amount_per_rate', 'tax_rate_per_line');
  // s. 3(c): CAD 500 or more – recipient's name, terms of payment, description.
  const above500 = totalWithTax >= CA_INVOICE_TIERS.recipientAndTerms;
  if (above500) fields.push('customer_name', 'line_description');
  return { fields, paymentTerms: above500 };
}

/** Provinces with a harmonized sales tax (single HST replaces the GST). */
const HST = (subdivision: string, validFrom: string, rate: number, provincialPart: number) => ({
  subdivision,
  validFrom,
  rates: [{ rate, kind: 'standard' as const, appliesTo: `HST, charged instead of the GST (5 % federal + ${provincialPart} % provincial)` }],
});

export const CA: CountryPack = {
  code: 'CA',
  name: 'Canada',
  region: 'americas',
  euMember: false,
  currency: 'CAD',
  currencyMinorUnits: 2,
  // The penny was withdrawn in 2013: cash totals round to 0.05, electronic payments do not.
  cashRounding: 0.05,
  timeZone: 'America/Toronto',
  locales: ['en', 'fr'],
  subdivisions: [
    { code: 'CA-AB', name: 'Alberta' },
    { code: 'CA-BC', name: 'British Columbia' },
    { code: 'CA-MB', name: 'Manitoba' },
    { code: 'CA-NB', name: 'New Brunswick' },
    { code: 'CA-NL', name: 'Newfoundland and Labrador' },
    { code: 'CA-NS', name: 'Nova Scotia' },
    { code: 'CA-NT', name: 'Northwest Territories' },
    { code: 'CA-NU', name: 'Nunavut' },
    { code: 'CA-ON', name: 'Ontario' },
    { code: 'CA-PE', name: 'Prince Edward Island' },
    { code: 'CA-QC', name: 'Quebec' },
    { code: 'CA-SK', name: 'Saskatchewan' },
    { code: 'CA-YT', name: 'Yukon' },
  ],
  taxIds: [
    {
      kind: 'company',
      label: { en: 'BN', fr: 'NE' },
      // Synthetic, Luhn-valid; not a published business.
      example: '123456782',
      normalize: (v) => normalizeCaId(v).slice(0, 9),
      validate: validateBusinessNumber,
      requiredOnInvoice: false,
      source: SRC.bn,
    },
    {
      kind: 'vat',
      label: { en: 'GST/HST No.', fr: 'No de TPS/TVH' },
      example: '123456782RT0001',
      normalize: normalizeCaId,
      validate: (v) => validateProgramAccount(v, 'RT'),
      // SOR/91-45 s. 3(b): from CAD 100 the buyer needs it for an input tax credit.
      requiredOnInvoice: true,
      source: SRC.itcRegs,
    },
    {
      // Québec only; the contract has no per-subdivision tax ID yet.
      kind: 'other',
      label: { en: 'QST No.', fr: 'No de TVQ' },
      example: '1234567890TQ0001',
      normalize: normalizeCaId,
      validate: validateQstNumber,
      requiredOnInvoice: true,
      source: SRC.qst,
    },
  ],
  indirectTax: {
    kind: 'gst',
    name: { en: 'GST/HST', fr: 'TPS/TVH' },
    rateSets: [
      {
        // Excise Tax Act s. 165(1); 5 % since 1 January 2008. Zero-rated supplies: Schedule VI.
        validFrom: '2008-01-01',
        rates: [
          { rate: 5, kind: 'standard', appliesTo: 'GST, federal, in every province without HST' },
          { rate: 0, kind: 'zero', appliesTo: 'zero-rated: basic groceries, prescription drugs, most medical devices, exports (ETA Sch. VI)' },
        ],
      },
      HST('CA-NB', '2016-07-01', 15, 10),
      HST('CA-NL', '2016-07-01', 15, 10),
      HST('CA-NS', '2010-07-01', 15, 10),
      HST('CA-NS', '2025-04-01', 14, 9),
      HST('CA-ON', '2010-07-01', 13, 8),
      HST('CA-PE', '2016-10-01', 15, 10),
      {
        subdivision: 'CA-QC',
        validFrom: '2013-01-01',
        rates: [{ rate: 9.975, kind: 'standard', appliesTo: 'QST (Revenu Québec), charged in addition to the 5 % GST, not on it' }],
      },
      {
        subdivision: 'CA-BC',
        validFrom: '2013-04-01',
        rates: [{ rate: 7, kind: 'standard', appliesTo: 'PST, charged in addition to the 5 % GST; only BC-registered vendors collect it' }],
      },
      {
        subdivision: 'CA-SK',
        validFrom: '2017-03-23',
        rates: [{ rate: 6, kind: 'standard', appliesTo: 'PST, charged in addition to the 5 % GST' }],
      },
      {
        subdivision: 'CA-MB',
        validFrom: '2019-07-01',
        rates: [{ rate: 7, kind: 'standard', appliesTo: 'RST, charged in addition to the 5 % GST' }],
      },
    ],
    smallBusiness: {
      // ETA s. 148: total taxable supplies of CAD 30,000 or less in a single
      // calendar quarter and over the last four consecutive quarters. Québec
      // applies the same CAD 30,000 test to the QST.
      threshold: 30000,
      currency: 'CAD',
      invoiceNote: {
        en: 'Small supplier – not registered for GST/HST.',
        fr: 'Petit fournisseur – non inscrit aux fichiers de la TPS/TVH.',
      },
      source: SRC.smallSupplier,
    },
    reverseChargeNote: {
      // ETA s. 217–218: the Canadian business recipient self-assesses tax on imported services.
      crossBorder: {
        en: 'Export of services – zero-rated (Excise Tax Act, Schedule VI, Part V).',
        fr: 'Exportation de services – détaxée (Loi sur la taxe d’accise, annexe VI, partie V).',
      },
    },
    source: SRC.rates,
  },
  invoice: {
    // SOR/91-45 s. 3, tiers by the total incl. tax; see caInvoiceFields for
    // the exact split. Below CAD 100 only name, date and total are needed.
    requirements: [
      { field: 'supplier_name', rule: 'SOR/91-45 s. 3(a)(i)' },
      { field: 'issue_date', rule: 'SOR/91-45 s. 3(a)(ii)' },
      { field: 'total_with_tax', rule: 'SOR/91-45 s. 3(a)(iii)' },
      { field: 'supplier_vat_id', when: 'above_simplified_threshold', rule: 'SOR/91-45 s. 3(b)(i) – CAD 100 or more' },
      { field: 'tax_amount_per_rate', when: 'above_simplified_threshold', rule: 'SOR/91-45 s. 3(b)(ii) – CAD 100 or more' },
      { field: 'tax_rate_per_line', when: 'above_simplified_threshold', rule: 'SOR/91-45 s. 3(b)(ii)–(iii) – CAD 100 or more' },
      // These two start at CAD 500, which `when` cannot express yet (one threshold only).
      { field: 'customer_name', when: 'above_simplified_threshold', rule: 'SOR/91-45 s. 3(c)(i) – CAD 500 or more' },
      { field: 'line_description', when: 'above_simplified_threshold', rule: 'SOR/91-45 s. 3(c)(iii) – CAD 500 or more' },
    ],
    simplifiedThreshold: { amount: CA_INVOICE_TIERS.registrationNumber, currency: 'CAD' },
    // No numbering rule in federal law; a unique reference is good practice.
    numbering: { gapless: false, multipleSeries: true },
    language: {
      note:
        'English or French. Charter of the French Language s. 57: invoices to customers in Québec must be in French, and since Bill 96 (2022) a French version must be at least as available as any other language.',
    },
    // ETA s. 159 requires the tax to be computed in CAD, but there is no rule that
    // the invoice shows it in CAD; see caveats.
    homeCurrencyTaxRequired: false,
    // ETA s. 286 / ITA s. 230: six years from the end of the year they relate to.
    retentionYears: 6,
    source: SRC.itcRegs,
  },
  einvoicing: [],
  payments: {
    iban: false,
    validateDomesticAccount: validateCaBankAccount,
    reference: 'free_text',
    localMethods: ['interac', 'eft', 'cheque', 'card'],
  },
  registry: {
    name: 'Corporations Canada (federal); provincial registries hold provincial corporations and sole proprietors',
    url: SRC.registry.url,
  },
  holidays: caFederalHolidays,
  deadlines: caFederalDeadlines,
  supportLevel: 'pack',
  verifiedAt: '2026-10-21',
  caveats: [
    'Invoice tiers follow the current SOR/91-45 s. 3 (CAD 100 / 500, raised from 30 / 150 in 2021). The CAD 500 tier (customer name, payment terms, description) is encoded with the single `above_simplified_threshold` flag, so a consumer would ask for it from CAD 100; use `caInvoiceFields` for the exact split.',
    'BN check digit: Luhn is the widely used scheme (same as the SIN) but CRA does not publish it; confirm against the CRA GST/HST registry before relying on it to reject input.',
    'QST number: only the shape (10 digits + TQ + 4 digits) is checked; non-resident QST registrants under the simplified system use a different NR format that is not accepted.',
    'Small supplier invoice note is our own wording. The law does not prescribe one; unregistered suppliers must simply not charge or show GST/HST.',
    'Québec French: the Charter s. 57 and the 2024 Regulation respecting the language of commerce and business need a Québec lawyer before we claim compliance; the B2B exception for English contracts under s. 55 is not modelled.',
    'Rate set start dates for provinces other than NS are the dates of the last rate change as we understand them; CRA only publishes the current table since 2013. BC PST, SK PST and MB RST have many exemptions and reduced rates (e.g. BC 12 % on some vehicles) that are not modelled.',
    'Selling into a province where the supplier is not resident: HST, QST and BC/SK/MB PST registration of out-of-province vendors (place-of-supply rules, ETA Sch. IX) is not modelled.',
    'Holidays: federal (Canada Labour Code s. 166) only. Provincial holidays and employer-specific substitute days (e.g. Boxing Day on a Saturday) are not in the list.',
    'No e-invoicing mandate (B2B or B2G) as of 2026-10. Industry groups (e.g. the Digital Business Networks Alliance) have run Peppol-style pilots and pushed for a framework, but we found no CRA or federal decision; recheck yearly.',
    'Deadlines: only federal GST/HST (calendar periods) and T1. PST, QST, corporate T2 and instalment dates are not listed.',
  ],
  sources: Object.values(SRC),
};

/**
 * Canadian domestic account: 5-digit transit (branch), 3-digit institution
 * and a 7 to 12 digit account number, as on a cheque's MICR line
 * ("12345-001-1234567"). No checksum is defined; only shape and the
 * all-zero transit / institution are rejected.
 * https://www.payments.ca/our-directories/financial-institutions-routing-numbers
 */
export function validateCaBankAccount(value: string): boolean {
  const m = /^(\d{5})[-\s]?(\d{3})[-\s]?(\d{7,12})$/.exec(value.trim());
  return m != null && m[1] !== '00000' && m[2] !== '000';
}

/** Electronic routing number used for EFT: '0' + institution (3) + transit (5). */
export function validateCaRoutingNumber(value: string): boolean {
  const v = value.replace(/[\s-]/g, '');
  return /^0\d{8}$/.test(v) && v.slice(1, 4) !== '000' && v.slice(4) !== '00000';
}
