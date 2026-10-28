import type { CountryPack, Source } from '../types.js';
import { jpDeadlines, jpHolidays } from './dates.js';
import {
  isValidJpBankAccount,
  isValidJpCorporateNumber,
  isValidJpInvoiceRegistrationNumber,
  normalizeJpCorporateNumber,
  normalizeJpInvoiceRegistrationNumber,
} from './tax-ids.js';

const INVOICE_SYSTEM: Source = {
  title: 'National Tax Agency – qualified invoice system (インボイス制度)',
  url: 'https://www.nta.go.jp/taxes/shiraberu/zeimokubetsu/shohi/keigenzeiritsu/invoice.htm',
};
const RATES: Source = {
  title: 'National Tax Agency – consumption tax rates and the reduced rate',
  url: 'https://www.nta.go.jp/taxes/shiraberu/zeimokubetsu/shohi/keigenzeiritsu/index.htm',
};
const CORPORATE_NUMBER: Source = {
  title: 'National Tax Agency – Corporate Number Publication Site (check digit)',
  url: 'https://www.houjin-bangou.nta.go.jp/en/',
};
const INVOICE_REGISTRY: Source = {
  title: 'Qualified Invoice Issuer Publication Site (Web-API)',
  url: 'https://www.invoice-kohyo.nta.go.jp/',
};
const HOLIDAYS: Source = {
  title: 'Cabinet Office – national holidays (国民の祝日について)',
  url: 'https://www8.cao.go.jp/chosei/shukujitsu/gaiyou.html',
};
const TRANSITIONAL_2026: Source = {
  title: 'FY2026 tax reform – transitional input credit 70/50/30 % (Yamada & Partners)',
  url: 'https://www.yamada-partners.jp/reform/r8/c01-2-revision-of-transitional-tax-credit-measures-for-taxable-purchases-from-tax-exempt-businesses',
};

export const JP: CountryPack = {
  code: 'JP',
  name: 'Japan',
  region: 'apac',
  euMember: false,
  currency: 'JPY',
  currencyMinorUnits: 0,
  timeZone: 'Asia/Tokyo',
  locales: ['ja', 'en'],
  taxIds: [
    {
      kind: 'vat',
      label: { ja: '登録番号', en: 'Invoice registration number' },
      // The National Tax Agency's own number.
      example: 'T7000012050002',
      normalize: normalizeJpInvoiceRegistrationNumber,
      validate: isValidJpInvoiceRegistrationNumber,
      requiredOnInvoice: true,
      source: INVOICE_SYSTEM,
    },
    {
      kind: 'company',
      label: { ja: '法人番号', en: 'Corporate number' },
      example: '7000012050002',
      normalize: normalizeJpCorporateNumber,
      validate: isValidJpCorporateNumber,
      requiredOnInvoice: false,
      source: CORPORATE_NUMBER,
    },
  ],
  indirectTax: {
    kind: 'vat',
    name: { ja: '消費税', en: 'Consumption tax' },
    rateSets: [
      {
        validFrom: '2014-04-01',
        rates: [{ rate: 8, kind: 'standard', appliesTo: '6.3 % national + 1.7 % local' }],
      },
      {
        validFrom: '2019-10-01',
        rates: [
          { rate: 10, kind: 'standard', appliesTo: '7.8 % national + 2.2 % local' },
          {
            rate: 8,
            kind: 'reduced',
            appliesTo: 'food and drink except alcohol and eating in; newspapers delivered twice a week or more (6.24 % + 1.76 %)',
          },
          { rate: 0, kind: 'zero', appliesTo: 'exports (Consumption Tax Act art. 7)' },
        ],
      },
    ],
    // Consumption Tax Act art. 9: exempt when taxable sales in the base period
    // (two years earlier) were JPY 10M or less. An exempt business cannot
    // register, so its invoices carry no registration number and no tax.
    smallBusiness: {
      threshold: 10_000_000,
      currency: 'JPY',
      invoiceNote: {
        ja: '当社は適格請求書発行事業者ではありません。',
        en: 'We are not a registered qualified invoice issuer.',
      },
      source: INVOICE_SYSTEM,
    },
    reverseChargeNote: {
      crossBorder: {
        ja: '特定課税仕入れ（リバースチャージ）の対象です。',
        en: 'Subject to the reverse charge on specified taxable purchases.',
      },
    },
    source: RATES,
  },
  invoice: {
    // No title is prescribed; 請求書 is customary. Content per Consumption Tax
    // Act art. 57-4(1); the simplified invoice (適格簡易請求書, art. 57-4(2))
    // is open to retail, restaurants, taxis and similar, not by amount.
    requirements: [
      { field: 'supplier_name', rule: 'Consumption Tax Act art. 57-4(1)(i)' },
      { field: 'supplier_vat_id', when: 'tax_registered', rule: 'art. 57-4(1)(i)' },
      { field: 'supply_date', rule: 'art. 57-4(1)(ii)' },
      { field: 'line_description', rule: 'art. 57-4(1)(iii) – mark reduced-rate items' },
      { field: 'tax_rate_per_line', rule: 'art. 57-4(1)(iv) – totals grouped by rate' },
      { field: 'tax_amount_per_rate', rule: 'art. 57-4(1)(v) – rounded once per rate' },
      { field: 'customer_name', rule: 'art. 57-4(1)(vi), not on a simplified invoice' },
      { field: 'invoice_number' },
      { field: 'issue_date' },
      { field: 'total_with_tax' },
    ],
    numbering: { gapless: false, multipleSeries: true },
    homeCurrencyTaxRequired: false,
    retentionYears: 7,
    source: INVOICE_SYSTEM,
  },
  // Peppol (JP PINT) exists but is voluntary; no mandate.
  einvoicing: [],
  payments: {
    iban: false,
    validateDomesticAccount: isValidJpBankAccount,
    reference: 'free_text',
    localMethods: ['furikomi', 'konbini', 'credit_card'],
  },
  registry: {
    name: 'NTA Qualified Invoice Issuer Publication Site',
    url: 'https://www.invoice-kohyo.nta.go.jp/',
    api: {
      url: 'https://www.invoice-kohyo.nta.go.jp/web-api/index.html',
      auth: 'api_key',
      notes: 'Free; needs an application ID from the NTA. The Corporate Number Web-API (houjin-bangou.nta.go.jp) works the same way.',
    },
  },
  holidays: jpHolidays,
  deadlines: jpDeadlines,
  supportLevel: 'pack',
  verifiedAt: '2026-10-28',
  caveats: [
    'Tax must be rounded once per rate per invoice, not per line (art. 57-4(1)(v), Cabinet Order art. 70-10). The contract has no rounding-mode field.',
    'Transitional input credit for purchases from non-registered suppliers, after the FY2026 tax reform: 70 % from 2026-10-01 to 2028-09-30, 50 % to 2030-09-30, 30 % to 2031-09-30, then none. Taken from the reform outline and practitioner summaries; the enacted text on nta.go.jp was not checked.',
    'Other transitional measures: the 2割特例 (pay 20 % of output tax) ends with the 2026 return; certain sole proprietors get a 3割特例 (30 %) for 2027–2028. The small-amount rule (purchases under JPY 10,000 need no qualified invoice, base-period sales ≤ JPY 100M) runs to 2029-09-30.',
    'Sole proprietors’ registration numbers are assumed to use the corporate number check digit; not confirmed in an NTA spec.',
    'Electronic invoices must be stored per the Electronic Bookkeeping Act (電子帳簿保存法) since 2024-01-01: search by date, amount and counterparty, tamper evidence. Not modelled.',
    'Retention 7 years from the day after the return due date (Cabinet Order art. 70-5); some losses carry forward 10 years for corporations.',
    'Foreign-currency invoices: whether the tax amount must also be stated in yen was not confirmed; homeCurrencyTaxRequired is false.',
    'Equinox holidays are official for 2026 and 2027; other years use an astronomical approximation. Holiday rules are wrong for 2019–2021 (one-off moves). Banks also close 31 Dec – 3 Jan, which is not a national holiday.',
    'There is no national payment QR for invoices (JPQR is for merchant payments); bank transfer (振込) is the norm, payers usually bear the fee.',
    'Deadlines cover individuals and March-year-end corporations only; interim consumption tax returns are not listed.',
  ],
  sources: [INVOICE_SYSTEM, RATES, CORPORATE_NUMBER, INVOICE_REGISTRY, HOLIDAYS, TRANSITIONAL_2026],
};
