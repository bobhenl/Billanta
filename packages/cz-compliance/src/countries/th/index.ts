import type { CountryPack, Source } from '../types.js';
import { thDeadlines, thHolidays } from './dates.js';
import { isValidThBankAccount, isValidThTaxId, normalizeThTaxId } from './tax-ids.js';

const REVENUE_CODE: Source = {
  title: 'Revenue Code, Chapter 4 Value Added Tax (Revenue Department)',
  url: 'https://www.rd.go.th/english/37749.html',
};
const VAT_DECREE_807: Source = {
  title: 'Royal Decree No. 807 – 7 % VAT to 30 Sep 2027 (KPMG summary)',
  url: 'https://kpmg.com/us/en/taxnewsflash/news/2026/09/thailand-reduced-7-percent-vat-rate-extended-through-september-2027.html',
};
const BOT_HOLIDAYS: Source = {
  title: 'Bank of Thailand – financial institutions’ holidays',
  url: 'https://www.bot.or.th/en/financial-institutions-holiday.html',
};
const ETAX: Source = {
  title: 'Revenue Department – e-Tax Invoice & e-Receipt',
  url: 'https://etax.rd.go.th/',
};
const EFILING_EXTENSION: Source = {
  title: '8-day e-filing extension to 31 Jan 2027 (Nishimura & Asahi)',
  url: 'https://www.nishimura.com/en/knowledge/publications/further-eight-day-extension-for-e-filing-tax-returns-and-online-tax-payments-in-thailand',
};

export const TH: CountryPack = {
  code: 'TH',
  name: 'Thailand',
  region: 'apac',
  euMember: false,
  currency: 'THB',
  currencyMinorUnits: 2,
  timeZone: 'Asia/Bangkok',
  locales: ['th', 'en'],
  taxIds: [
    {
      kind: 'vat',
      label: { th: 'เลขประจำตัวผู้เสียภาษีอากร', en: 'Tax ID' },
      // PTT Public Company Limited, a listed company.
      example: '0107544000108',
      normalize: normalizeThTaxId,
      validate: isValidThTaxId,
      requiredOnInvoice: true,
      source: REVENUE_CODE,
    },
  ],
  indirectTax: {
    kind: 'vat',
    name: { th: 'ภาษีมูลค่าเพิ่ม', en: 'VAT' },
    // The statutory rate is 10 % (s. 80); royal decrees have cut it to 7 %
    // (6.3 % VAT + 0.7 % local tax) since 1999, renewed one year at a time.
    rateSets: [
      {
        validFrom: '1999-04-01',
        rates: [
          { rate: 7, kind: 'standard', appliesTo: 'goods and services (reduced from the statutory 10 % by royal decree)' },
          { rate: 0, kind: 'zero', appliesTo: 'exports and services used abroad (s. 80/1)' },
        ],
      },
    ],
    // s. 81/1: registration is compulsory above THB 1.8M a year; below it a
    // business may not issue tax invoices at all.
    smallBusiness: {
      threshold: 1_800_000,
      currency: 'THB',
      invoiceNote: {
        th: 'ผู้ขายไม่ได้จดทะเบียนภาษีมูลค่าเพิ่ม เอกสารนี้ไม่ใช่ใบกำกับภาษี',
        en: 'The seller is not VAT-registered; this document is not a tax invoice.',
      },
      source: REVENUE_CODE,
    },
    reverseChargeNote: {
      crossBorder: {
        th: 'ผู้รับบริการจากต่างประเทศนำส่งภาษีตามแบบ ภ.พ.36',
        en: 'VAT on services from abroad is self-assessed by the recipient on form P.P.36.',
      },
    },
    source: VAT_DECREE_807,
  },
  invoice: {
    // s. 86/4 requires the words "tax invoice" in a prominent place; s. 86/6
    // lets retailers issue an abbreviated one.
    title: {
      standard: { th: 'ใบกำกับภาษี', en: 'Tax Invoice' },
      simplified: { th: 'ใบกำกับภาษีอย่างย่อ', en: 'Abbreviated Tax Invoice' },
    },
    requirements: [
      { field: 'document_title', rule: 'Revenue Code s. 86/4(1)' },
      { field: 'supplier_name', rule: 's. 86/4(2)' },
      { field: 'supplier_address', rule: 's. 86/4(2)' },
      { field: 'supplier_vat_id', rule: 's. 86/4(2)' },
      { field: 'customer_name', rule: 's. 86/4(3)' },
      { field: 'customer_address', rule: 's. 86/4(3)' },
      { field: 'customer_vat_id', when: 'b2b', rule: 's. 86/4(3), DG Notification on VAT No. 199' },
      { field: 'invoice_number', rule: 's. 86/4(4)' },
      { field: 'line_description', rule: 's. 86/4(5)' },
      { field: 'line_quantity', rule: 's. 86/4(5)' },
      { field: 'line_unit_price', rule: 's. 86/4(5)' },
      { field: 'tax_amount_per_rate', rule: 's. 86/4(6)' },
      { field: 'issue_date', rule: 's. 86/4(7)' },
      { field: 'tax_in_local_currency', when: 'cross_border', rule: 's. 86/4 last paragraph' },
    ],
    numbering: { gapless: true, multipleSeries: true },
    language: {
      required: ['th'],
      note: 'Thai language and Thai baht, unless the Director-General allows another language or currency (s. 86/4 last paragraph).',
    },
    homeCurrencyTaxRequired: true,
    retentionYears: 5,
    source: REVENUE_CODE,
  },
  // e-Tax Invoice & e-Receipt is voluntary; there is no mandate to record.
  einvoicing: [],
  payments: {
    iban: false,
    validateDomesticAccount: isValidThBankAccount,
    qr: ['promptpay'],
    reference: 'free_text',
    localMethods: ['promptpay', 'bank_transfer'],
  },
  registry: {
    name: 'Department of Business Development – DBD DataWarehouse+',
    url: 'https://datawarehouse.dbd.go.th/',
  },
  holidays: thHolidays,
  deadlines: thDeadlines,
  supportLevel: 'pack',
  verifiedAt: '2026-10-28',
  caveats: [
    'The 7 % VAT rate runs only to 2027-09-30 under Royal Decree No. 807; without a new decree the statutory 10 % applies from 2027-10-01. The contract cannot express an end date, so the rate set has none.',
    'The 1999-04-01 start of the 7 % rate set is from memory of the 1999 royal decree and was not checked against the Royal Gazette.',
    'Tax invoices must show "head office" (สำนักงานใหญ่) or the 5-digit branch number of the seller and of a VAT-registered buyer (DG Notification on VAT No. 199). The contract has no field for it.',
    'Retention: 5 years (s. 87/3); the RD may extend it to 7 years.',
    'e-Tax Invoice & e-Receipt (ETDA XML standard, or e-Tax Invoice by Email for small issuers) is voluntary; no mandate was found as of the verification date.',
    'The 8-day e-filing extension (P.P.30 by the 23rd, P.N.D.90/91 by 8 April) is valid to 2027-01-31; a renewal was not yet published. Deadlines are not moved off weekends or holidays.',
    'Holidays are official only for 2026 and 2027 (Bank of Thailand). Other years return the solar-calendar dates only, without the Buddhist lunar holidays, substitutes or cabinet bridge days.',
    'Domestic bank account validation checks the 10- or 12-digit shape only.',
    'PromptPay QR follows the BOT Thai QR Payment standard (EMVCo merchant-presented). A juristic person can register its tax ID as the PromptPay proxy, so the tax ID can feed the QR.',
    'Corporate income tax (P.N.D.50, 150 days after the fiscal year end) and withholding tax forms are not in the deadline list.',
  ],
  sources: [REVENUE_CODE, VAT_DECREE_807, BOT_HOLIDAYS, ETAX, EFILING_EXTENSION],
};
