import type { CountryPack } from '../types.js';
import { plDeadlines } from './deadlines.js';
import { plHolidays } from './holidays.js';
import { PL_EINVOICING, PL_INVOICE_RULES } from './invoice.js';
import { PL_NBP_RATES, PL_WHITE_LIST } from './registries.js';
import { PL_TAX_IDS } from './tax-ids.js';
import { PL_INDIRECT_TAX, PL_VAT_ACT_URL } from './vat.js';

export * from './deadlines.js';
export * from './holidays.js';
export * from './invoice.js';
export * from './registries.js';
export * from './tax-ids.js';
export * from './vat.js';

export const PL: CountryPack = {
  code: 'PL',
  name: 'Poland',
  region: 'eu',
  euMember: true,
  currency: 'PLN',
  currencyMinorUnits: 2,
  timeZone: 'Europe/Warsaw',
  locales: ['pl', 'en'],
  taxIds: PL_TAX_IDS,
  indirectTax: PL_INDIRECT_TAX,
  invoice: PL_INVOICE_RULES,
  einvoicing: PL_EINVOICING,
  payments: {
    // Polish accounts are NRB, i.e. the 26 digits of a PL IBAN.
    iban: true,
    // Transfers carry a free-text "tytuł przelewu"; a split payment
    // (komunikat przelewu) also needs the invoice number, the seller's NIP
    // and the VAT amount, which the bank builds from these fields.
    reference: 'free_text',
    localMethods: ['bank_transfer', 'blik', 'pay_by_link', 'split_payment'],
  },
  registry: PL_WHITE_LIST,
  holidays: plHolidays,
  deadlines: plDeadlines,
  supportLevel: 'pack',
  verifiedAt: '2026-10-21',
  caveats: [
    'KSeF is mandatory and the contract has no lifecycle for it: an invoice is legally issued only when KSeF returns its number. FA(3) generation, the KSeF API client, offline24 and KOD I/II QR codes are not built.',
    'KSeF dates (1 Feb 2026, 1 Apr 2026, relief and penalties from 1 Jan 2027) come from the MF small-business page and trade press; the exact articles of the 2025 amendment act were not re-read.',
    'Invoice numbering: art. 106e asks for a consecutive number identifying the invoice uniquely; whether gaps are tolerated is practice, not statute, so `gapless` is false. A Polish accountant should confirm.',
    'Annex 15 (MPP goods and services) is not encoded; `mppRequired` needs an item flag from the product catalogue.',
    'The 0 % VAT on basic food (Feb 2022 – Mar 2024) and other temporary rate changes per item are not modelled.',
    'ZBP payment QR (pipe-separated) is not added to `payments.qr`: its exact format was not confirmed from the ZBP recommendation.',
    'Retention: 5 years from the end of the year the tax fell due, not from the issue date.',
    'Income-tax and ZUS deadlines cover a sole trader paying for themselves; quarterly payers, employers (PIT-4R, PIT-11), JPK_V7K and the health-contribution article reference need an accountant\'s check.',
    'NIP and REGON validators check format and checksum only; PESEL (for sole traders without NIP on B2C) is not validated.',
    'Holiday amendment acts are cited by name and date, not by Dz.U. position.',
  ],
  sources: [
    { title: 'Ustawa z dnia 11 marca 2004 r. o podatku od towarów i usług (ISAP)', url: PL_VAT_ACT_URL },
    { title: 'Ministerstwo Finansów – KSeF dla JDG i MŚP', url: 'https://ksef.podatki.gov.pl/jdg-i-msp/' },
    { title: 'Ustawa o dniach wolnych od pracy (ISAP)', url: 'https://isap.sejm.gov.pl/isap.nsf/DocDetails.xsp?id=WDU19510040028' },
    { title: 'Ordynacja podatkowa (ISAP)', url: 'https://isap.sejm.gov.pl/isap.nsf/DocDetails.xsp?id=WDU19971370926' },
    { title: 'Wykaz podatników VAT – API', url: 'https://wl-api.mf.gov.pl/' },
    PL_NBP_RATES,
    { title: 'Jednolity Plik Kontrolny', url: 'https://www.podatki.gov.pl/jednolity-plik-kontrolny/' },
    { title: 'Platforma Elektronicznego Fakturowania', url: 'https://efaktura.gov.pl/' },
  ],
};
