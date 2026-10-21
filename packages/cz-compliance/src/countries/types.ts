/**
 * The contract every country pack implements. A pack is plain data plus a few
 * pure functions, so a country can be added (and reviewed) without touching
 * the CZ/SK code paths. Capabilities are optional: a country can launch with
 * tax IDs, tax rates and the mandatory invoice content only, and gain a
 * registry lookup, e-invoicing or a tax calendar later. UI and backend check
 * for the capability (`pack.registry != null`), never for the country code.
 *
 * Compliance code never reads the UI locale; the locale never decides tax
 * rules (see docs/expansion/architecture.md §2.1).
 *
 * Every rule that comes from a law or an authority carries its source, and
 * every pack records the date its data was last checked, because rates and
 * e-invoicing deadlines change every year.
 */

/** ISO 3166-1 alpha-2, upper case. */
export type CountryCode = string;

/** ISO 4217, upper case. */
export type CurrencyCode = string;

export type Region = 'eu' | 'europe' | 'americas' | 'apac' | 'mena';

/** Text in the country's language(s) plus English, keyed by BCP 47 tag. */
export type LocalizedText = Readonly<Record<string, string>> & { readonly en: string };

export interface Source {
  title: string;
  url: string;
}

/** A state, province, emirate… when tax rules or registries differ by it. */
export interface Subdivision {
  /** ISO 3166-2 code, e.g. 'US-CA', 'CA-QC', 'AE-DU'. */
  code: string;
  name: string;
}

export type CountryTaxIdKind =
  /** Company / business register number (IČO, KRS, SIREN, ABN, EIN…). */
  | 'company'
  /** VAT / GST / sales-tax registration number (DIČ, USt-IdNr, TRN, GST/HST BN…). */
  | 'vat'
  /** Income-tax or other number some invoices must show (DE Steuernummer, IT codice fiscale). */
  | 'tax'
  | 'other';

export interface TaxIdSpec {
  kind: CountryTaxIdKind;
  /** Short local name shown as the field label, e.g. 'NIP', 'ABN', 'TRN'. */
  label: LocalizedText;
  /** A valid example for placeholders and tests (a public, published example – never a real private person's ID). */
  example: string;
  /** Strips spaces, dashes, a country prefix… so `validate` and storage see one form. */
  normalize(value: string): string;
  /** Format and checksum only; no network call. */
  validate(value: string): boolean;
  /** Whether a business invoice must show it (when the supplier has one). */
  requiredOnInvoice: boolean;
  source?: Source;
}

export interface TaxRate {
  /** Percent, e.g. 21 or 8.1. */
  rate: number;
  kind: 'standard' | 'reduced' | 'super_reduced' | 'parking' | 'zero';
  /** Short description of what the rate covers, in English. */
  appliesTo?: string;
}

export interface TaxRateSet {
  /** ISO date the set applies from. Sets are sorted by date, the last one is current. */
  validFrom: string;
  rates: readonly TaxRate[];
  /** Set when the rates differ per subdivision (US states, CA provinces); `rates` then holds the federal / common part. */
  subdivision?: string;
}

export interface IndirectTax {
  /** 'none' for countries without a general consumption tax on invoices (e.g. some US states, or none at all). */
  kind: 'vat' | 'gst' | 'sales_tax' | 'none';
  /** Local name, e.g. 'DPH', 'MwSt.', 'TVA', 'GST/HST', 'Sales tax'. */
  name: LocalizedText;
  rateSets: readonly TaxRateSet[];
  /** Small-business exemption (Kleinunternehmer, franchise en base, KOR…) – the threshold and the note the invoice must carry. */
  smallBusiness?: {
    threshold: number;
    currency: CurrencyCode;
    /** Mandatory invoice note for an exempt supplier. */
    invoiceNote: LocalizedText;
    source?: Source;
  };
  /** Registration threshold when it differs from the small-business one (e.g. AE AED 375,000; AU AUD 75,000). */
  registrationThreshold?: { amount: number; currency: CurrencyCode };
  /** Notes for reverse charge: domestic (construction, scrap…) and cross-border. */
  reverseChargeNote?: { domestic?: LocalizedText; crossBorder?: LocalizedText };
  source?: Source;
}

/** A piece of data a valid invoice must contain in this country. */
export type InvoiceField =
  | 'invoice_number'
  | 'issue_date'
  | 'supply_date'
  | 'due_date'
  | 'supplier_name'
  | 'supplier_address'
  | 'supplier_company_id'
  | 'supplier_vat_id'
  | 'supplier_tax_id'
  | 'customer_name'
  | 'customer_address'
  | 'customer_vat_id'
  | 'line_description'
  | 'line_quantity'
  | 'line_unit_price'
  | 'tax_rate_per_line'
  | 'tax_amount_per_rate'
  | 'total_with_tax'
  | 'tax_in_local_currency'
  | 'document_title';

export interface InvoiceRequirement {
  field: InvoiceField;
  /** When the requirement applies; missing = always. */
  when?: 'tax_registered' | 'b2b' | 'cross_border' | 'above_simplified_threshold';
  /** Legal basis, e.g. '§14 Abs. 4 UStG'. */
  rule?: string;
}

export interface InvoiceRules {
  /** What the document must be called, when the law prescribes it ('Tax Invoice' in AU/NZ/SG/AE, 'Faktura VAT'…). */
  title?: { standard: LocalizedText; simplified?: LocalizedText };
  requirements: readonly InvoiceRequirement[];
  /** Simplified invoices allowed below this amount (incl. tax). */
  simplifiedThreshold?: { amount: number; currency: CurrencyCode };
  numbering: {
    /** A continuous, gapless sequence is required (most EU countries). */
    gapless: boolean;
    /** Several series are allowed (per branch, per year…). */
    multipleSeries: boolean;
    /** Series must be registered or communicated to the authority first (PT, ES VeriFactu…). */
    seriesRegistration?: boolean;
  };
  /** Language rules, e.g. invoices must be in the local language or carry a translation. */
  language?: { required?: readonly string[]; note?: string };
  /** Tax amounts must also be shown in the home currency when invoicing in another one. */
  homeCurrencyTaxRequired: boolean;
  /** Years the issuer must keep invoices. */
  retentionYears: number;
  source?: Source;
}

export interface EInvoiceMandate {
  scope: 'b2g' | 'b2b' | 'b2c';
  /** 'clearance' = the authority must accept the invoice before it is valid (IT SdI, PL KSeF, SA FATOORA phase 2…). */
  model: 'post_audit' | 'clearance' | 'real_time_reporting' | 'peppol_exchange';
  /** ISO date it applies from, or 'in_force'. */
  from: string;
  /** Who it applies to, e.g. 'issuers with turnover > EUR 800,000'. */
  appliesTo?: string;
  /** Format(s) accepted: 'peppol_bis', 'xrechnung', 'zugferd', 'fatturapa', 'ksef_fa3', 'facturx', 'ubl', 'cii', 'zatca_ubl', 'saf_t_pt'… */
  formats: readonly string[];
  /** The platform or network, e.g. 'SdI', 'KSeF', 'Peppol', 'NAV Online Számla', 'FATOORA'. */
  platform?: string;
  source?: Source;
}

export interface PaymentRules {
  /** IBAN is the domestic account format. */
  iban: boolean;
  /** Validates a domestic account when it is not an IBAN (US routing + account, AU BSB, CA transit…). */
  validateDomesticAccount?: (value: string) => boolean;
  /** Payment QR schemes in order of preference: 'epc', 'spayd', 'pay_by_square', 'promptpay', 'swiss_qr'… */
  qr?: readonly string[];
  /** How the payer references the invoice: CZ symbols, SEPA RF creditor reference, BE structured communication, free text. */
  reference: 'cz_symbols' | 'sepa_rf' | 'be_structured' | 'fi_reference' | 'free_text';
  /** Common local methods to mention in invoice settings: 'sepa', 'ideal', 'bizum', 'blik', 'ach', 'interac', 'payid', 'promptpay'… */
  localMethods: readonly string[];
}

export interface CompanyRegistry {
  name: string;
  url: string;
  /** Public API that Billanta could call; missing when only a web search exists. */
  api?: { url: string; auth: 'none' | 'api_key' | 'oauth' | 'certificate'; notes?: string };
}

export interface CountryTaxDeadline {
  /** ISO date. */
  date: string;
  /** Stable key, e.g. 'vat_return', 'gst_bas', 'sales_tax_ca'. */
  kind: string;
  title: LocalizedText;
  /** Who it concerns, e.g. 'monthly VAT filers'. */
  appliesTo?: string;
}

export type SupportLevel =
  /** Data researched and validated, nothing wired into the app yet. */
  | 'pack'
  /** Tenants of this country can issue compliant invoices. */
  | 'invoicing'
  /** Invoicing plus e-invoicing / registry / tax calendar. */
  | 'full';

export interface CountryPack {
  code: CountryCode;
  /** English name. */
  name: string;
  region: Region;
  euMember: boolean;
  currency: CurrencyCode;
  /** Decimal places used on invoices (JPY 0, HUF usually 0, most 2). */
  currencyMinorUnits: number;
  /** Cash rounding rule, when one applies (CH 0.05, some EU countries for cash). */
  cashRounding?: number;
  timeZone: string;
  /** UI locales that fit this country, first = default. */
  locales: readonly string[];
  subdivisions?: readonly Subdivision[];
  taxIds: readonly TaxIdSpec[];
  indirectTax: IndirectTax;
  invoice: InvoiceRules;
  einvoicing: readonly EInvoiceMandate[];
  payments: PaymentRules;
  registry?: CompanyRegistry;
  /** Public holidays as ISO dates. */
  holidays(year: number): string[];
  deadlines?(year: number): CountryTaxDeadline[];
  supportLevel: SupportLevel;
  /** ISO date the data was last checked against the sources. */
  verifiedAt: string;
  /** Things that still need a native accountant or lawyer, or a source that could not be confirmed. */
  caveats: readonly string[];
  sources: readonly Source[];
}
