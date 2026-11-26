import type { CountryPack, CountryTaxDeadline, Source, TaxRate } from '../types.js';
import { easterOffset, isoList, nextWorkingDay, weekdayOnOrAfter, ymd } from '../se/calendar.js';
import { isValidLtCompanyCode, isValidLtVat, normalizeLtCompanyCode, normalizeLtVat } from './ids.js';

export * from './ids.js';

const PVMI: Source = {
  title: 'Pridėtinės vertės mokesčio įstatymas (e-TAR)',
  url: 'https://www.e-tar.lt/portal/lt/legalAct/TAR.0F3D9FA05EB9/asr',
};
const VMI_PVM: Source = {
  title: 'VMI – Pridėtinės vertės mokestis',
  url: 'https://www.vmi.lt/evmi/pridetines-vertes-mokestis',
};
const RATES_2026: Source = {
  title: 'Seimas – PVM įstatymo pakeitimas XV-287 (9 % rate abolished from 2026-01-01)',
  url: 'https://www.lrs.lt/sip/portal.show?p_r=35403',
};
const ISAF: Source = { title: 'VMI – i.SAF (PVM sąskaitų faktūrų registrai)', url: 'https://www.vmi.lt/evmi/i.saf' };
const ESASKAITA: Source = { title: 'E. sąskaita – viešojo sektoriaus e. sąskaitos', url: 'https://www.esaskaita.eu' };
const DARBO_KODEKSAS: Source = {
  title: 'Darbo kodeksas 123 str. (švenčių dienos)',
  url: 'https://www.e-tar.lt/portal/lt/legalAct/f6d686707e7011e6b969d7ae07280e89/asr',
};
const RC: Source = { title: 'Registrų centras – Juridinių asmenų registras', url: 'https://www.registrucentras.lt' };

/**
 * i.SAF is not an e-invoicing mandate: every VAT payer reports the register of
 * issued and received VAT invoices to VMI by the 20th of the next month
 * (PVM įstatymo 78 str., VMI viršininko įsakymas Nr. VA-49). The contract has
 * no periodic invoice reporting model, so it is described here for the app.
 */
export const LT_ISAF = {
  name: 'i.SAF',
  dueDay: 20,
  format: 'i.SAF XML (VMI schema)',
  appliesTo: 'all VAT payers, monthly register of issued and received VAT invoices',
  source: ISAF,
} as const;

/** Švenčių dienos of Darbo kodeksas 123 str. */
function holidays(year: number): string[] {
  return isoList([
    ymd(year, 1, 1),
    ymd(year, 2, 16), // Valstybės atkūrimo diena
    ymd(year, 3, 11), // Nepriklausomybės atkūrimo diena
    easterOffset(year, 0),
    easterOffset(year, 1),
    ymd(year, 5, 1),
    weekdayOnOrAfter(year, 5, 1, 0), // Motinos diena, first Sunday of May
    weekdayOnOrAfter(year, 6, 1, 0), // Tėvo diena, first Sunday of June
    ymd(year, 6, 24), // Joninės
    ymd(year, 7, 6), // Valstybės diena
    ymd(year, 8, 15), // Žolinė
    ymd(year, 11, 1),
    ymd(year, 11, 2), // Vėlinės
    ymd(year, 12, 24),
    ymd(year, 12, 25),
    ymd(year, 12, 26),
  ]);
}

/**
 * PVM deklaracija (FR0600) and payment: the 25th of the month after the
 * period (PVM įstatymo 85 str.); i.SAF on the 20th. Moved to the next working
 * day (Mokesčių administravimo įstatymas).
 */
function deadlines(year: number): CountryTaxDeadline[] {
  const off = holidays(year);
  const months = Array.from({ length: 12 }, (_, i) => i + 1);
  return [
    ...months.map((m) => ({
      date: nextWorkingDay(ymd(year, m, 20), off),
      kind: 'isaf',
      title: { lt: 'i.SAF duomenų pateikimas', en: 'i.SAF invoice register' },
      appliesTo: 'all VAT payers (previous month)',
    })),
    ...months.map((m) => ({
      date: nextWorkingDay(ymd(year, m, 25), off),
      kind: 'vat_return_monthly',
      title: { lt: 'PVM deklaracija (FR0600)', en: 'VAT return (FR0600)' },
      appliesTo: 'VAT payers (previous month)',
    })),
  ].sort((a, b) => a.date.localeCompare(b.date));
}

const ZERO: TaxRate = { rate: 0, kind: 'zero', appliesTo: 'intra-EU supplies, exports' };

export const LT: CountryPack = {
  code: 'LT',
  name: 'Lithuania',
  region: 'eu',
  euMember: true,
  currency: 'EUR',
  currencyMinorUnits: 2,
  timeZone: 'Europe/Vilnius',
  locales: ['lt', 'en'],
  taxIds: [
    {
      kind: 'company',
      label: { lt: 'Įmonės kodas', en: 'Company code' },
      example: '188659752',
      normalize: normalizeLtCompanyCode,
      validate: isValidLtCompanyCode,
      requiredOnInvoice: true,
      source: RC,
    },
    {
      kind: 'vat',
      label: { lt: 'PVM mokėtojo kodas', en: 'VAT number' },
      example: 'LT119511515',
      normalize: normalizeLtVat,
      validate: isValidLtVat,
      // PVM įstatymo 80 str. 1 d. 3 p.: the seller's and the buyer's PVM code.
      requiredOnInvoice: true,
      source: VMI_PVM,
    },
  ],
  indirectTax: {
    kind: 'vat',
    name: { lt: 'Pridėtinės vertės mokestis (PVM)', en: 'VAT' },
    // PVM įstatymo 19 str.
    rateSets: [
      {
        validFrom: '2009-09-01',
        rates: [
          { rate: 21, kind: 'standard' },
          {
            rate: 9,
            kind: 'reduced',
            appliesTo: 'books, accommodation, passenger transport, cultural events, district heating and hot water, firewood',
          },
          { rate: 5, kind: 'super_reduced', appliesTo: 'reimbursed medicines and medical aids, press' },
          ZERO,
        ],
      },
      {
        // Law XV-287: 9 % abolished. Books → 5 %; accommodation, passenger transport and culture → 12 %;
        // district heating, hot water and firewood → 21 %.
        validFrom: '2026-01-01',
        rates: [
          { rate: 21, kind: 'standard', appliesTo: 'all supplies without a reduced rate, incl. district heating and firewood' },
          { rate: 12, kind: 'reduced', appliesTo: 'accommodation, passenger transport, cultural events' },
          { rate: 5, kind: 'super_reduced', appliesTo: 'books, reimbursed medicines and medical aids, press' },
          ZERO,
        ],
      },
    ],
    smallBusiness: {
      // PVM įstatymo 71 str. 2 d.: registration required above EUR 45,000 in the previous 12 months.
      threshold: 45_000,
      currency: 'EUR',
      invoiceNote: {
        lt: 'Pardavėjas nėra PVM mokėtojas.',
        en: 'The seller is not registered for VAT.',
      },
      source: VMI_PVM,
    },
    reverseChargeNote: {
      domestic: { lt: 'Atvirkštinis apmokestinimas', en: 'Reverse charge' },
      crossBorder: { lt: 'Atvirkštinis apmokestinimas', en: 'Reverse charge' },
    },
    source: PVMI,
  },
  invoice: {
    // PVM įstatymo 80 str. 1 d. (PVM sąskaitos faktūros rekvizitai).
    title: { standard: { lt: 'PVM sąskaita faktūra', en: 'VAT invoice' } },
    requirements: [
      { field: 'document_title', when: 'tax_registered', rule: 'PVM įstatymo 80 str. 1 d. 1 p.' },
      { field: 'invoice_number', rule: 'PVM įstatymo 80 str. 1 d. 2 p.' },
      { field: 'issue_date', rule: 'PVM įstatymo 80 str. 1 d. 3 p.' },
      { field: 'supplier_name', rule: 'PVM įstatymo 80 str. 1 d. 4 p.' },
      { field: 'supplier_address', rule: 'PVM įstatymo 80 str. 1 d. 4 p.' },
      { field: 'supplier_vat_id', rule: 'PVM įstatymo 80 str. 1 d. 4 p.' },
      { field: 'customer_name', rule: 'PVM įstatymo 80 str. 1 d. 5 p.' },
      { field: 'customer_address', rule: 'PVM įstatymo 80 str. 1 d. 5 p.' },
      { field: 'customer_vat_id', when: 'b2b', rule: 'PVM įstatymo 80 str. 1 d. 5 p.' },
      { field: 'line_description', rule: 'PVM įstatymo 80 str. 1 d. 6 p.' },
      { field: 'line_quantity', rule: 'PVM įstatymo 80 str. 1 d. 6 p.' },
      { field: 'supply_date', rule: 'PVM įstatymo 80 str. 1 d. 7 p.' },
      { field: 'line_unit_price', rule: 'PVM įstatymo 80 str. 1 d. 8 p.' },
      { field: 'tax_rate_per_line', rule: 'PVM įstatymo 80 str. 1 d. 9 p.' },
      { field: 'tax_amount_per_rate', rule: 'PVM įstatymo 80 str. 1 d. 10 p.' },
      { field: 'tax_in_local_currency', rule: 'PVM įstatymo 80 str. 1 d. (VAT in euros)' },
    ],
    numbering: { gapless: false, multipleSeries: true },
    homeCurrencyTaxRequired: true,
    // Buhalterinės apskaitos įstatymas 19 str. / archive rules: accounting documents for 10 years.
    retentionYears: 10,
    source: PVMI,
  },
  einvoicing: [
    {
      scope: 'b2g',
      model: 'peppol_exchange',
      from: '2017-07-01',
      appliesTo: 'invoices to Lithuanian contracting authorities',
      formats: ['peppol_bis', 'en16931'],
      platform: 'E. sąskaita',
      source: ESASKAITA,
    },
  ],
  payments: {
    iban: true,
    qr: ['epc'],
    reference: 'free_text',
    localMethods: ['sepa'],
  },
  registry: { name: 'Registrų centras – Juridinių asmenų registras', url: 'https://www.registrucentras.lt' },
  holidays,
  deadlines,
  supportLevel: 'pack',
  verifiedAt: '2026-10-28',
  caveats: [
    'i.SAF (monthly invoice register, due the 20th) and i.MAS are periodic reporting, which the contract cannot express; see the exported LT_ISAF constant.',
    'Changes for catering and medicines from 2026 were discussed but are not confirmed; only Law XV-287 changes are modelled.',
    'A rise of the registration threshold to EUR 60,000 was proposed; not confirmed as enacted, so EUR 45,000 is kept.',
    'The pre-2026 rate set is modelled from 2009-09-01 with simplified item lists.',
    'PVM įstatymo article and item numbers (19, 71, 80, 85) and the 10-year retention are from memory.',
    'Source deep links for e-TAR and the Seimas release are not checked.',
  ],
  sources: [PVMI, VMI_PVM, RATES_2026, ISAF, ESASKAITA, DARBO_KODEKSAS, RC],
};
