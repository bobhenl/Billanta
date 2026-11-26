import type { CountryPack, Source } from '../types.js';
import { hkHolidays } from './dates.js';
import { isValidHkBankAccount, isValidHkBrNumber, normalizeHkBrNumber } from './tax-ids.js';

const BR: Source = {
  title: 'Inland Revenue Department – Business Registration',
  url: 'https://www.ird.gov.hk/eng/tax/bre.htm',
};
const RECORDS: Source = {
  title: 'Inland Revenue Ordinance s. 51C – keeping business records for 7 years',
  url: 'https://www.elegislation.gov.hk/hk/cap112',
};
const HOLIDAYS: Source = {
  title: 'GovHK – general holidays',
  url: 'https://www.gov.hk/en/about/abouthk/holiday/',
};
const FPS: Source = {
  title: 'HKMA – Faster Payment System and the Common QR Code',
  url: 'https://www.hkma.gov.hk/eng/key-functions/international-financial-centre/financial-market-infrastructure/faster-payment-system-fps/',
};

export const HK: CountryPack = {
  code: 'HK',
  name: 'Hong Kong',
  region: 'apac',
  euMember: false,
  currency: 'HKD',
  currencyMinorUnits: 2,
  timeZone: 'Asia/Hong_Kong',
  locales: ['zh-HK', 'en'],
  taxIds: [
    {
      kind: 'company',
      label: { 'zh-HK': '商業登記號碼', en: 'BR number' },
      example: '12345678-000',
      normalize: normalizeHkBrNumber,
      validate: isValidHkBrNumber,
      requiredOnInvoice: false,
      source: BR,
    },
  ],
  // Hong Kong has no VAT, GST or sales tax.
  indirectTax: {
    kind: 'none',
    name: { 'zh-HK': '不適用', en: 'None' },
    rateSets: [],
  },
  invoice: {
    // No statute prescribes invoice content; this is the practical minimum
    // that supports the profits tax records s. 51C asks for.
    requirements: [
      { field: 'invoice_number', rule: 'practice' },
      { field: 'issue_date', rule: 'practice' },
      { field: 'supplier_name', rule: 'practice' },
      { field: 'supplier_address', rule: 'practice' },
      { field: 'customer_name', rule: 'practice' },
      { field: 'line_description', rule: 'practice' },
      { field: 'total_with_tax', rule: 'practice' },
    ],
    numbering: { gapless: false, multipleSeries: true },
    homeCurrencyTaxRequired: false,
    retentionYears: 7,
    source: RECORDS,
  },
  einvoicing: [],
  payments: {
    iban: false,
    validateDomesticAccount: isValidHkBankAccount,
    qr: ['fps'],
    reference: 'free_text',
    localMethods: ['fps', 'bank_transfer', 'cheque'],
  },
  registry: {
    name: 'Companies Registry – e-Search (ICRIS)',
    url: 'https://www.e-services.cr.gov.hk/',
  },
  holidays: hkHolidays,
  supportLevel: 'pack',
  verifiedAt: '2026-10-28',
  caveats: [
    'No statutory invoice content: the requirement list is common practice, not law.',
    'BR number validation checks the shape only (8 digits, optional 3-digit branch, optional full certificate suffix); the IRD publishes no check digit. The example is a placeholder of the right shape.',
    'Limited companies also have a Companies Registry number (CR No.); it is not modelled as a separate tax ID.',
    'Companies Registry search is paid per document; there is no free public API.',
    'FPS QR follows the HKMA Common QR Code specification (EMVCo-based); the payee can be an FPS ID, phone, e-mail or account number.',
    'Holidays are gazetted for 2026 and 2027 only; other years return the solar and Easter dates without the Chinese-calendar holidays or substitutes.',
    'No tax deadlines: profits tax and salaries tax returns are issued individually (usually early April and May) with a one-month due date, and the block extension dates for tax representatives change every year.',
  ],
  sources: [BR, RECORDS, HOLIDAYS, FPS],
};
