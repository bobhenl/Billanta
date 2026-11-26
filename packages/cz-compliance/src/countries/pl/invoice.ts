import type { EInvoiceMandate, InvoiceRules } from '../types.js';
import { PL_VAT_ACT_URL } from './vat.js';

/**
 * Mandatory invoice content, art. 106e ust. 1 ustawy o VAT. Not modelled by
 * the contract and handled elsewhere: the VAT amount in PLN on a
 * foreign-currency invoice (ust. 11, see `homeCurrencyTaxRequired`), the
 * supply date only when it differs from the issue date (pkt 6), and the
 * annotations in `PL_INVOICE_NOTES`.
 */
export const PL_INVOICE_RULES: InvoiceRules = {
  // The law prescribes no title since 2013; "Faktura" is what the KSeF
  // visualisation and every Polish tool print.
  title: {
    standard: { pl: 'Faktura', en: 'Invoice' },
    simplified: { pl: 'Faktura uproszczona', en: 'Simplified invoice' },
  },
  requirements: [
    { field: 'issue_date', rule: 'art. 106e ust. 1 pkt 1' },
    // "Kolejny numer nadany w ramach jednej lub więcej serii".
    { field: 'invoice_number', rule: 'art. 106e ust. 1 pkt 2' },
    { field: 'supplier_name', rule: 'art. 106e ust. 1 pkt 3' },
    { field: 'supplier_address', rule: 'art. 106e ust. 1 pkt 3' },
    { field: 'customer_name', rule: 'art. 106e ust. 1 pkt 3' },
    { field: 'customer_address', rule: 'art. 106e ust. 1 pkt 3' },
    { field: 'supplier_vat_id', rule: 'art. 106e ust. 1 pkt 4' },
    { field: 'customer_vat_id', when: 'b2b', rule: 'art. 106e ust. 1 pkt 5' },
    { field: 'supply_date', rule: 'art. 106e ust. 1 pkt 6, when it differs from the issue date' },
    { field: 'line_description', rule: 'art. 106e ust. 1 pkt 7' },
    { field: 'line_quantity', rule: 'art. 106e ust. 1 pkt 8' },
    { field: 'line_unit_price', rule: 'art. 106e ust. 1 pkt 9' },
    { field: 'tax_rate_per_line', when: 'tax_registered', rule: 'art. 106e ust. 1 pkt 12' },
    { field: 'tax_amount_per_rate', when: 'tax_registered', rule: 'art. 106e ust. 1 pkt 13–14' },
    { field: 'total_with_tax', rule: 'art. 106e ust. 1 pkt 15' },
  ],
  // Art. 106e ust. 5 pkt 3: up to PLN 450 or EUR 100 gross the buyer's name
  // and address and per-rate totals may be left out.
  simplifiedThreshold: { amount: 450, currency: 'PLN' },
  numbering: {
    // The law asks for a consecutive number in one or more series that
    // identifies the invoice uniquely, not explicitly for no gaps.
    gapless: false,
    multipleSeries: true,
  },
  // Art. 106e ust. 11: the VAT amount in PLN when invoicing in another currency.
  homeCurrencyTaxRequired: true,
  // Art. 112: until the end of the limitation period, i.e. 5 years from the
  // end of the year the tax fell due (Ordynacja podatkowa art. 70 § 1).
  retentionYears: 5,
  source: { title: 'Ustawa o VAT, art. 106e', url: PL_VAT_ACT_URL },
};

const KSEF_SME = {
  title: 'Ministerstwo Finansów – KSeF dla JDG i MŚP',
  url: 'https://ksef.podatki.gov.pl/jdg-i-msp/',
};

/**
 * KSeF (art. 106ga and art. 145l–145m ustawy o VAT, as amended by the KSeF
 * acts of 16 June 2023 and 2025). A KSeF invoice exists only once the system
 * has assigned its KSeF number, hence `clearance`.
 */
export const PL_EINVOICING: readonly EInvoiceMandate[] = [
  {
    scope: 'b2b',
    model: 'clearance',
    from: '2026-02-01',
    appliesTo: 'issuers with 2024 sales above PLN 200 million; receiving through KSeF for every taxpayer',
    formats: ['ksef_fa3'],
    platform: 'KSeF',
    source: KSEF_SME,
  },
  {
    scope: 'b2b',
    model: 'clearance',
    from: '2026-04-01',
    appliesTo: 'all other taxpayers, VAT-exempt (art. 113) ones included',
    formats: ['ksef_fa3'],
    platform: 'KSeF',
    source: KSEF_SME,
  },
  {
    scope: 'b2b',
    model: 'clearance',
    from: '2027-01-01',
    appliesTo:
      'end of the 2026 relief (invoices up to PLN 10,000 gross a month and cash-register invoices outside KSeF); money penalties of art. 106ni apply',
    formats: ['ksef_fa3'],
    platform: 'KSeF',
    source: KSEF_SME,
  },
  {
    // Ustawa z 9 listopada 2018 r. o elektronicznym fakturowaniu w
    // zamówieniach publicznych: public buyers must accept structured
    // invoices through PEF since 18 April 2019; sending one stays optional.
    scope: 'b2g',
    model: 'peppol_exchange',
    from: 'in_force',
    appliesTo: 'public contracting authorities must accept; suppliers may send',
    formats: ['peppol_bis'],
    platform: 'PEF (Platforma Elektronicznego Fakturowania), Peppol',
    source: { title: 'Platforma Elektronicznego Fakturowania', url: 'https://efaktura.gov.pl/' },
  },
];
