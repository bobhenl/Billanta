import type { IndirectTax, LocalizedText, TaxRateSet } from '../types.js';

export const PL_VAT_ACT_URL = 'https://isap.sejm.gov.pl/isap.nsf/DocDetails.xsp?id=WDU20040540535';

/**
 * Rates since EU accession: 22/7/3/0 from 1 May 2004 (art. 41 ustawy o VAT,
 * original text) and 23/8/5/0 from 1 January 2011 (art. 146a, now art. 146ef,
 * nominally temporary rates that keep being extended). The 0 % rate on basic
 * food from 1 February 2022 to 31 March 2024 (anti-inflation shield) moved
 * goods between rates, so it is not a rate set of its own.
 */
export const PL_VAT_RATE_SETS: readonly TaxRateSet[] = [
  {
    validFrom: '2004-05-01',
    rates: [
      { rate: 22, kind: 'standard' },
      { rate: 7, kind: 'reduced', appliesTo: 'Annex 3 goods and services, housing construction' },
      { rate: 3, kind: 'super_reduced', appliesTo: 'unprocessed agricultural products' },
      { rate: 0, kind: 'zero', appliesTo: 'intra-EU supplies, exports, international transport' },
    ],
  },
  {
    validFrom: '2011-01-01',
    rates: [
      { rate: 23, kind: 'standard' },
      {
        rate: 8,
        kind: 'reduced',
        appliesTo: 'Annex 3: housing construction, catering, passenger transport, some food, medicines',
      },
      { rate: 5, kind: 'reduced', appliesTo: 'Annex 10: basic food, books, periodicals' },
      { rate: 0, kind: 'zero', appliesTo: 'intra-EU supplies (WDT), exports, international transport' },
    ],
  },
];

/**
 * Markers printed instead of a rate (KSeF FA(3) field P_12): `zw` exempt
 * (art. 43, art. 113), `np` not taxable in Poland (e.g. B2B services with the
 * place of supply abroad, art. 28b), `oo` domestic reverse charge (art. 17
 * ust. 1 pkt 7–8).
 */
export const PL_VAT_MARKERS = ['zw', 'np', 'oo'] as const;
export type PlVatMarker = (typeof PL_VAT_MARKERS)[number];

/**
 * Annotations from art. 106e ust. 1 ustawy o VAT. The wording is prescribed,
 * so the Polish text is what must be printed.
 */
export const PL_INVOICE_NOTES = {
  /** Pkt 16: cash accounting (art. 21). */
  cashAccounting: { pl: 'metoda kasowa', en: 'cash accounting' },
  /** Pkt 17: invoice issued by the buyer (art. 106d). */
  selfBilling: { pl: 'samofakturowanie', en: 'self-billing' },
  /** Pkt 18: reverse charge, domestic and cross-border alike. */
  reverseCharge: { pl: 'odwrotne obciążenie', en: 'reverse charge' },
  /** Pkt 18a: split payment, see `mppRequired`. */
  splitPayment: { pl: 'mechanizm podzielonej płatności', en: 'split payment mechanism' },
} as const satisfies Record<string, LocalizedText>;

/**
 * Art. 106e ust. 1 pkt 18a and art. 108a ust. 1a ustawy o VAT: split payment
 * (and the note) is mandatory when the gross total exceeds PLN 15,000 (the
 * amount in art. 19 pkt 2 Prawa przedsiębiorców) and the invoice contains
 * goods or services listed in Annex 15. The comparison is in PLN, also for a
 * foreign-currency invoice (converted at the art. 31a rate).
 */
export const PL_MPP_THRESHOLD_PLN = 15_000;

export function mppRequired(grossTotalPln: number, hasAnnex15Item: boolean): boolean {
  return hasAnnex15Item && grossTotalPln > PL_MPP_THRESHOLD_PLN;
}

/**
 * Small-business exemption, art. 113 ust. 1 ustawy o VAT: PLN 240,000 of
 * sales in the previous year since 1 January 2026 (ustawa z 24 czerwca 2025,
 * Dz.U. 2025 poz. 896; PLN 200,000 before), pro rata in the first year
 * (art. 113 ust. 9). Art. 106e ust. 1 pkt 19 requires the legal basis of the
 * exemption on the invoice.
 */
export const PL_SMALL_BUSINESS_THRESHOLD_PLN = 240_000;

export const PL_INDIRECT_TAX: IndirectTax = {
  kind: 'vat',
  name: { pl: 'VAT (podatek od towarów i usług)', en: 'VAT' },
  rateSets: PL_VAT_RATE_SETS,
  smallBusiness: {
    threshold: PL_SMALL_BUSINESS_THRESHOLD_PLN,
    currency: 'PLN',
    invoiceNote: {
      pl: 'Zwolnienie z VAT na podstawie art. 113 ust. 1 ustawy o podatku od towarów i usług',
      en: 'Exempt from VAT under Article 113(1) of the Polish VAT Act',
    },
    source: { title: 'Ustawa o VAT, art. 113 ust. 1 i art. 106e ust. 1 pkt 19', url: PL_VAT_ACT_URL },
  },
  reverseChargeNote: {
    domestic: PL_INVOICE_NOTES.reverseCharge,
    crossBorder: PL_INVOICE_NOTES.reverseCharge,
  },
  source: { title: 'Ustawa z dnia 11 marca 2004 r. o podatku od towarów i usług', url: PL_VAT_ACT_URL },
};
