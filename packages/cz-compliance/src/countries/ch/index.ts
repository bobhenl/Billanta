import type { CountryPack, CountryTaxDeadline, IndirectTax, InvoiceRules, TaxRateSet } from '../types.js';
import { addDays, easterOffset, nextWorkingDay, ymd } from '../de/dates.js';
import { CH_TAX_IDS } from './tax-ids.js';

const MWSTG = 'https://www.fedlex.admin.ch/eli/cc/2009/615/de';
const ESTV_RATES = 'https://www.estv.admin.ch/estv/de/home/mehrwertsteuer/mwst-steuersaetze.html';

/**
 * Holidays observed in every canton: Neujahr, Auffahrt, Bundesfeier
 * (1 August, Art. 110 Abs. 3 BV – the only federal one) and Weihnachten.
 * Everything else (Karfreitag, Ostermontag, Pfingstmontag, Stephanstag,
 * Berchtoldstag…) is cantonal; see caveats.
 */
export function swissHolidays(year: number): string[] {
  return [ymd(year, 1, 1), easterOffset(year, 39), ymd(year, 8, 1), ymd(year, 12, 25)].sort();
}

/**
 * MWST returns and payment are due 60 days after the period ends (Art. 71
 * Abs. 1 and Art. 86 Abs. 1 MWSTG). Quarterly is the default (Art. 35 Abs. 1
 * lit. a), half-yearly with the Saldosteuersatz method (lit. b). A deadline
 * on a weekend or holiday moves to the next working day (Art. 20 Abs. 3 VwVG).
 */
export function vatReturnDeadlines(year: number, holidays: (year: number) => readonly string[]): CountryTaxDeadline[] {
  const after60 = (periodEnd: string) => nextWorkingDay(addDays(periodEnd, 60), holidays);
  const quarterEnds = [ymd(year - 1, 12, 31), ymd(year, 3, 31), ymd(year, 6, 30), ymd(year, 9, 30)];
  const out: CountryTaxDeadline[] = quarterEnds.map((end) => ({
    date: after60(end),
    kind: 'vat_return_quarterly',
    title: { de: 'MWST-Abrechnung (Quartal)', fr: 'Décompte TVA (trimestre)', en: 'VAT return (quarterly)' },
    appliesTo: 'effective method (default)',
  }));
  for (const end of [ymd(year - 1, 12, 31), ymd(year, 6, 30)]) {
    out.push({
      date: after60(end),
      kind: 'vat_return_semiannual',
      title: { de: 'MWST-Abrechnung (Semester)', fr: 'Décompte TVA (semestre)', en: 'VAT return (half-yearly)' },
      appliesTo: 'Saldosteuersatz / flat-rate method',
    });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

const STANDARD = (rate: number) => ({ rate, kind: 'standard', appliesTo: 'most goods and services' }) as const;
const REDUCED = (rate: number) =>
  ({ rate, kind: 'reduced', appliesTo: 'food, non-alcoholic drinks, books, newspapers, medicines, water' }) as const;
// The "Sondersatz" for accommodation (Art. 25 Abs. 4 MWSTG); the contract has no own kind for it.
const LODGING = (rate: number) => ({ rate, kind: 'reduced', appliesTo: 'accommodation (Beherbergung)' }) as const;

/**
 * Art. 25 MWSTG. 2018: the IV surcharge ended and the FABI share started.
 * 2024: +0.4 pp for the AHV 21 reform (popular vote of 25 Sep 2022).
 * Liechtenstein applies the same rates by treaty, so LI imports this too.
 */
export const SWISS_RATE_SETS: readonly TaxRateSet[] = [
  { validFrom: '2011-01-01', rates: [STANDARD(8), REDUCED(2.5), LODGING(3.8)] },
  { validFrom: '2018-01-01', rates: [STANDARD(7.7), REDUCED(2.5), LODGING(3.7)] },
  { validFrom: '2024-01-01', rates: [STANDARD(8.1), REDUCED(2.6), LODGING(3.8)] },
];

/** Shared by CH and LI: both MWSTG follow the same structure (Art. 26 / Art. 26 LI-MWSTG). */
export function swissStyleInvoice(source: { title: string; url: string }): InvoiceRules {
  return {
    // Art. 26 Abs. 2 MWSTG. Neither an invoice number nor an issue date is required by the MWSTG.
    requirements: [
      { field: 'supplier_name', rule: 'Art. 26 Abs. 2 lit. a MWSTG' },
      { field: 'supplier_address', rule: 'Art. 26 Abs. 2 lit. a MWSTG (place of business)' },
      { field: 'supplier_vat_id', rule: 'Art. 26 Abs. 2 lit. a MWSTG' },
      { field: 'customer_name', rule: 'Art. 26 Abs. 2 lit. b MWSTG', when: 'above_simplified_threshold' },
      { field: 'customer_address', rule: 'Art. 26 Abs. 2 lit. b MWSTG', when: 'above_simplified_threshold' },
      { field: 'supply_date', rule: 'Art. 26 Abs. 2 lit. c MWSTG' },
      { field: 'line_description', rule: 'Art. 26 Abs. 2 lit. d MWSTG' },
      { field: 'line_quantity', rule: 'Art. 26 Abs. 2 lit. d MWSTG' },
      { field: 'total_with_tax', rule: 'Art. 26 Abs. 2 lit. e MWSTG' },
      { field: 'tax_rate_per_line', rule: 'Art. 26 Abs. 2 lit. f MWSTG' },
      // When the price includes tax, the rate alone is enough (Art. 26 Abs. 2 lit. f).
      { field: 'tax_amount_per_rate', rule: 'Art. 26 Abs. 2 lit. f MWSTG' },
    ],
    // Receipts up to CHF 400 may leave out the recipient (Art. 57 MWSTV).
    simplifiedThreshold: { amount: 400, currency: 'CHF' },
    numbering: { gapless: false, multipleSeries: true },
    language: { note: 'Any official language (de, fr, it, rm) or English; the authority may ask for a translation otherwise.' },
    // Art. 54 Abs. 2 MWSTG: amounts in a foreign currency are converted to CHF for the tax.
    homeCurrencyTaxRequired: true,
    // Art. 70 Abs. 2 MWSTG and Art. 958f OR: 10 years (20 for immovable property).
    retentionYears: 10,
    source,
  };
}

/** Shared by CH and LI: same registration threshold under both MWSTG (Art. 10 Abs. 2 lit. a). */
export function swissStyleIndirectTax(lawName: string, source: { title: string; url: string }): IndirectTax {
  return {
    kind: 'vat',
    name: { de: 'Mehrwertsteuer (MWST)', fr: 'TVA', it: 'IVA', en: 'VAT (MWST)' },
    rateSets: SWISS_RATE_SETS,
    smallBusiness: {
      threshold: 100_000,
      currency: 'CHF',
      // Not prescribed; a non-registered business must not show VAT, or it owes it (Art. 27 Abs. 2 MWSTG).
      invoiceNote: {
        de: 'Nicht mehrwertsteuerpflichtig.',
        fr: 'Non assujetti à la TVA.',
        it: 'Non assoggettato all’IVA.',
        en: 'Not registered for VAT.',
      },
      source: { title: `Art. 10 Abs. 2 lit. a ${lawName}`, url: source.url },
    },
    reverseChargeNote: {
      // Services to recipients abroad are taxed at the recipient's place (Art. 8 Abs. 1 MWSTG).
      crossBorder: {
        de: 'Leistung im Ausland steuerbar (Empfängerortsprinzip).',
        fr: 'Prestation imposable à l’étranger (lieu du destinataire).',
        en: 'Supply taxable abroad (place of the recipient).',
      },
    },
    source,
  };
}

export const CH: CountryPack = {
  code: 'CH',
  name: 'Switzerland',
  region: 'europe',
  euMember: false,
  currency: 'CHF',
  currencyMinorUnits: 2,
  // Cash payments are rounded to 5 Rappen (smallest coin); transfers are exact.
  cashRounding: 0.05,
  timeZone: 'Europe/Zurich',
  locales: ['de-CH', 'de', 'fr', 'it', 'en'],
  taxIds: CH_TAX_IDS,
  indirectTax: swissStyleIndirectTax('MWSTG', { title: 'Art. 25 MWSTG', url: MWSTG }),
  invoice: swissStyleInvoice({ title: 'Art. 26 MWSTG', url: `${MWSTG}#art_26` }),
  einvoicing: [
    {
      scope: 'b2g',
      model: 'post_audit',
      from: '2016-01-01',
      appliesTo: 'suppliers to the federal administration with contracts above CHF 5,000',
      formats: ['peppol_bis', 'ebill'],
      platform: 'Federal administration e-invoicing (EFV)',
      source: { title: 'EFV – E-Rechnung an die Bundesverwaltung', url: 'https://www.efv.admin.ch/efv/de/home/themen/finanzpolitik_grundlagen/e-rechnung.html' },
    },
  ],
  payments: {
    iban: true,
    // Swiss QR-bill (SIX Implementation Guidelines QR-bill 2.x); replaced the orange/red slips in Oct 2022.
    qr: ['swiss_qr'],
    reference: 'sepa_rf',
    localMethods: ['ebill', 'twint', 'lsv', 'card'],
  },
  registry: {
    name: 'Zefix / UID-Register',
    url: 'https://www.zefix.admin.ch/',
    api: { url: 'https://www.uid-wse.admin.ch/', auth: 'none', notes: 'UID-Register public web service (SOAP); Zefix REST needs credentials on request.' },
  },
  holidays: swissHolidays,
  deadlines: (year) => vatReturnDeadlines(year, swissHolidays),
  supportLevel: 'pack',
  verifiedAt: '2026-10-21',
  caveats: [
    'Holidays are cantonal. Only the four observed everywhere are listed; Karfreitag, Ostermontag, Pfingstmontag and Stephanstag are holidays in most cantons, Berchtoldstag, Fronleichnam, Mariä Himmelfahrt and others in some. Needs CH-xx subdivisions.',
    'Payment reference: QR-bills use either a 27-digit QR reference (QRR, mod 10 recursive, with a QR-IBAN) or the ISO 11649 creditor reference (SCOR). The contract only has "sepa_rf"; a "ch_qrr" value is needed.',
    'Small business: CHF 100,000 worldwide turnover (Art. 10 Abs. 2 lit. a MWSTG); CHF 250,000 for non-profit sports/cultural clubs. Voluntary registration is possible.',
    'Annual settlement (Art. 35 Abs. 1bis MWSTG, from 2025) for turnover up to CHF 5.005 million with instalments is not in the deadline list.',
    'Federal B2G e-invoice formats are not confirmed from the EFV pages (Peppol and eBill assumed).',
    'Rates may change again for the 13th AHV pension (planned VAT increase); check the ESTV rate page each year.',
    'Invoice number and issue date are not required by Art. 26 MWSTG but are required in practice for bookkeeping (Art. 957a OR).',
  ],
  sources: [
    { title: 'Mehrwertsteuergesetz (MWSTG, SR 641.20)', url: MWSTG },
    { title: 'Mehrwertsteuerverordnung (MWSTV, SR 641.201)', url: 'https://www.fedlex.admin.ch/eli/cc/2009/828/de' },
    { title: 'ESTV – MWST-Steuersätze', url: ESTV_RATES },
    { title: 'SIX – QR-bill', url: 'https://www.six-group.com/en/products-services/banking-services/payment-standardization/standards/qr-bill.html' },
    { title: 'BFS – UID', url: 'https://www.uid.admin.ch/' },
  ],
};
