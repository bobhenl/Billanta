import type { CountryPack, Source } from '../types.js';
import { ukBankHolidays, ukDeadlines } from './calendar.js';
import {
  isValidCompanyNumber,
  isValidUkBankAccount,
  isValidUkVatNumber,
  normalizeCompanyNumber,
  normalizeUkVatNumber,
} from './tax-ids.js';

export { ukBankHolidays, ukDeadlines, ukVatReturnDue, type UkNation } from './calendar.js';
export {
  isNorthernIrelandVatNumber,
  isValidCompanyNumber,
  isValidUkBankAccount,
  isValidUkVatNumber,
  normalizeCompanyNumber,
  normalizeUkVatNumber,
} from './tax-ids.js';

const NOTICE_700: Source = {
  title: 'HMRC VAT Notice 700 – The VAT Guide (section 16, VAT invoices)',
  url: 'https://www.gov.uk/guidance/vat-guide-notice-700',
};
const VAT_RATES: Source = { title: 'GOV.UK – VAT rates', url: 'https://www.gov.uk/vat-rates' };
const VAT_REGISTRATION: Source = {
  title: 'GOV.UK – VAT registration: when to register',
  url: 'https://www.gov.uk/vat-registration/when-to-register',
};
const TRADING_DISCLOSURES: Source = {
  title: 'Company, LLP and Business (Names and Trading Disclosures) Regulations 2015, reg. 24',
  url: 'https://www.legislation.gov.uk/uksi/2015/17/regulation/24',
};
const E_INVOICING: Source = {
  title: 'GOV.UK – Promoting electronic invoicing across UK businesses and the public sector: consultation response',
  url: 'https://www.gov.uk/government/consultations/promoting-electronic-invoicing-across-uk-businesses-and-the-public-sector/outcome/promoting-electronic-invoicing-across-uk-businesses-and-the-public-sector-consultation-response',
};

/**
 * United Kingdom. The pack follows England & Wales; Scotland and Northern
 * Ireland differ only in bank holidays (see `ukBankHolidays`) and, for NI, in
 * the XI VAT prefix for goods under the Windsor Framework.
 */
export const GB: CountryPack = {
  code: 'GB',
  name: 'United Kingdom',
  region: 'europe',
  euMember: false,
  currency: 'GBP',
  currencyMinorUnits: 2,
  timeZone: 'Europe/London',
  locales: ['en'],
  subdivisions: [
    { code: 'GB-ENG', name: 'England' },
    { code: 'GB-WLS', name: 'Wales' },
    { code: 'GB-SCT', name: 'Scotland' },
    { code: 'GB-NIR', name: 'Northern Ireland' },
  ],
  taxIds: [
    {
      kind: 'vat',
      label: { en: 'VAT registration number' },
      // HMRC's own published test number; passes the mod 97 check.
      example: 'GB 999 9999 73',
      normalize: normalizeUkVatNumber,
      validate: isValidUkVatNumber,
      // VAT Notice 700 §16.3: a VAT invoice must show the supplier's VAT registration number.
      requiredOnInvoice: true,
      source: NOTICE_700,
    },
    {
      kind: 'company',
      label: { en: 'Company number' },
      // Tesco PLC, a public Companies House record.
      example: '00445790',
      normalize: normalizeCompanyNumber,
      validate: isValidCompanyNumber,
      // Trading Disclosures Regulations 2015 reg. 24: registered number on business documents, invoices included.
      requiredOnInvoice: true,
      source: TRADING_DISCLOSURES,
    },
  ],
  indirectTax: {
    kind: 'vat',
    name: { en: 'VAT' },
    rateSets: [
      {
        // 17.5% → 20% from 4 January 2011 (Finance (No. 2) Act 2010, s. 3); 5% and 0% unchanged since.
        validFrom: '2011-01-04',
        rates: [
          { rate: 20, kind: 'standard' },
          { rate: 5, kind: 'reduced', appliesTo: 'domestic fuel and power, children’s car seats, some energy-saving materials' },
          { rate: 0, kind: 'zero', appliesTo: 'most food, books and newspapers, children’s clothes, exports' },
        ],
      },
    ],
    // No invoice note exists for unregistered traders: below the threshold
    // they simply cannot charge VAT or issue VAT invoices.
    registrationThreshold: { amount: 90000, currency: 'GBP' },
    reverseChargeNote: {
      domestic: {
        en: 'Reverse charge: customer to account to HMRC for the VAT (domestic reverse charge for construction services, VAT Notice 735 / CIS)',
      },
      crossBorder: { en: 'Reverse charge: the customer accounts for the VAT (place of supply outside the UK)' },
    },
    source: VAT_RATES,
  },
  invoice: {
    // VAT Notice 700 §16.3: a "full VAT invoice". No prescribed document title.
    requirements: [
      { field: 'invoice_number', when: 'tax_registered', rule: 'VAT Notice 700 §16.3; VAT Regulations 1995 reg. 14' },
      { field: 'issue_date', when: 'tax_registered', rule: 'VAT Notice 700 §16.3' },
      { field: 'supply_date', when: 'tax_registered', rule: 'VAT Notice 700 §16.3 (time of supply / tax point)' },
      { field: 'supplier_name', rule: 'VAT Notice 700 §16.3' },
      { field: 'supplier_address', rule: 'VAT Notice 700 §16.3' },
      { field: 'supplier_vat_id', when: 'tax_registered', rule: 'VAT Notice 700 §16.3' },
      { field: 'supplier_company_id', rule: 'Trading Disclosures Regulations 2015 reg. 24 (companies and LLPs)' },
      { field: 'customer_name', when: 'tax_registered', rule: 'VAT Notice 700 §16.3' },
      { field: 'customer_address', when: 'tax_registered', rule: 'VAT Notice 700 §16.3' },
      { field: 'customer_vat_id', when: 'cross_border', rule: 'VAT Notice 700 §16.3 (NI goods to EU, reverse charge)' },
      { field: 'line_description', rule: 'VAT Notice 700 §16.3' },
      { field: 'line_quantity', when: 'tax_registered', rule: 'VAT Notice 700 §16.3' },
      { field: 'line_unit_price', when: 'tax_registered', rule: 'VAT Notice 700 §16.3 (unit price excluding VAT)' },
      { field: 'tax_rate_per_line', when: 'tax_registered', rule: 'VAT Notice 700 §16.3' },
      { field: 'tax_amount_per_rate', when: 'tax_registered', rule: 'VAT Notice 700 §16.3' },
      { field: 'total_with_tax', rule: 'VAT Notice 700 §16.3' },
      { field: 'tax_in_local_currency', when: 'tax_registered', rule: 'VAT Notice 700 §16.3 (total VAT in sterling)' },
    ],
    // VAT Notice 700 §16.6: retailers may issue a simplified invoice up to GBP 250 incl. VAT.
    simplifiedThreshold: { amount: 250, currency: 'GBP' },
    // "A sequential number based on one or more series" (§16.3).
    numbering: { gapless: true, multipleSeries: true },
    homeCurrencyTaxRequired: true,
    // VAT Notice 700/21: VAT records kept 6 years.
    retentionYears: 6,
    source: NOTICE_700,
  },
  einvoicing: [
    {
      scope: 'b2b',
      model: 'peppol_exchange',
      from: '2029-04-01',
      appliesTo: 'all VAT invoices; implementation roadmap announced for the 2026 Budget',
      formats: ['peppol_bis'],
      platform: 'Peppol',
      source: E_INVOICING,
    },
    {
      scope: 'b2g',
      model: 'peppol_exchange',
      from: '2029-04-01',
      appliesTo: 'all VAT invoices to public bodies',
      formats: ['peppol_bis'],
      platform: 'Peppol',
      source: E_INVOICING,
    },
  ],
  payments: {
    iban: false,
    validateDomesticAccount: isValidUkBankAccount,
    reference: 'free_text',
    localMethods: ['faster_payments', 'bacs', 'direct_debit', 'card'],
  },
  registry: {
    name: 'Companies House',
    url: 'https://find-and-update.company-information.service.gov.uk/',
    api: {
      url: 'https://api.company-information.service.gov.uk',
      auth: 'api_key',
      notes: 'Free key from developer.company-information.service.gov.uk; HTTP Basic with the key as user name. VAT numbers are checked separately via HMRC "Check a UK VAT number" API.',
    },
  },
  holidays: (year) => ukBankHolidays(year, 'GB-ENG'),
  deadlines: ukDeadlines,
  supportLevel: 'pack',
  verifiedAt: '2026-10-28',
  caveats: [
    'Holidays are the England & Wales list; Scotland (2 Jan, St Andrew’s Day, first Monday of August, no Easter Monday) and Northern Ireland (St Patrick’s Day, 12 July) are available via ukBankHolidays(year, nation) but the contract has no per-subdivision holiday hook.',
    'Northern Ireland: goods supplies use the XI prefix (Windsor Framework) and EU VAT rules for goods; the validator accepts XI but the pack does not model NI goods rules (EU intra-community supply notes, EU customer VAT IDs).',
    'E-invoicing: the April 2029 mandate is confirmed policy (consultation response, Peppol named June 2026) but not yet legislated; the exact day, format list and clearance/reporting model await the Budget 2026 roadmap. Model and the 1 April date are assumptions.',
    'The NHS already requires Peppol invoices from many suppliers by procurement policy, not by law – not modelled as a mandate.',
    'Making Tax Digital for VAT applies to all VAT-registered businesses (VAT Notice 700/22): records must be kept digitally and returns filed through MTD-compatible software. Billanta would need HMRC MTD API recognition to file returns.',
    'VAT deadlines are shown for calendar-quarter staggers only; other staggers, monthly returns and the Annual Accounting Scheme differ. Direct Debit payments are collected 3 working days later.',
    'MTD for Income Tax quarterly updates assume standard tax-year quarters; calendar-quarter election shifts nothing in deadlines but changes the periods.',
    'Sort code + account check is format-only (6 + 8 digits). Some banks issue 7- or 10-digit accounts that must be padded/truncated per Pay.UK rules; modulus checking is not implemented.',
    'Gapless numbering: HMRC asks for a unique sequential number; gaps are not illegal if explained. Marked gapless to keep Billanta conservative.',
    'Flat Rate Scheme and cash accounting do not change invoice content but are not modelled.',
  ],
  sources: [
    NOTICE_700,
    VAT_RATES,
    VAT_REGISTRATION,
    TRADING_DISCLOSURES,
    E_INVOICING,
    { title: 'GOV.UK – UK bank holidays', url: 'https://www.gov.uk/bank-holidays' },
    { title: 'GOV.UK – VAT returns: deadlines', url: 'https://www.gov.uk/vat-returns/deadlines' },
    { title: 'GOV.UK – Self Assessment deadlines', url: 'https://www.gov.uk/self-assessment-tax-returns/deadlines' },
    {
      title: 'GOV.UK – Check if you’re eligible for Making Tax Digital for Income Tax',
      url: 'https://www.gov.uk/guidance/check-if-youre-eligible-for-making-tax-digital-for-income-tax',
    },
  ],
};
