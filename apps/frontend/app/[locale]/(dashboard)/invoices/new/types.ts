/** Wire shapes of the backend endpoints the new-invoice form uses (apps/backend/src/{contacts,invoices,ai}). */

import type { ReverseChargeCode } from '@faktur/cz-compliance';

export interface Contact {
  id: string;
  legalName: string;
  ico: string | null;
  dic: string | null;
  email: string | null;
  phone?: string | null;
  addressStreet: string | null;
  addressCity: string | null;
  addressPostalCode: string | null;
  addressCountry: string;
  isVatPayer: boolean | null;
  isStarred: boolean;
  isPerson?: boolean;
  /** Colour label (lib/contact-colors). */
  color?: string | null;
  /** Private note, never printed. */
  internalNote?: string | null;
  portalToken?: string | null;
}

export interface AresPrefill {
  ico: string;
  dic: string | null;
  legalName: string;
  isVatPayer: boolean | null;
  addressStreet: string | null;
  addressCity: string | null;
  addressPostalCode: string | null;
  addressCountry: string;
  /** Register the hit came from; foreign ones (FR/NO/PL/VIES) have an empty `ico`. */
  source?: 'ARES' | 'RPO' | 'FR' | 'NO' | 'PL' | 'VIES';
  /** Foreign registration number (SIREN, org.nr, NIP …). */
  regNumber?: string | null;
}

export interface ItemSuggestion {
  description: string;
  unitPrice: number;
  vatRate: number | null;
}

export interface SuggestionResult {
  suggestion: {
    customer: { ico: string | null; name: string | null };
    items: { description: string; quantity: number; unit_price: number; vat_rate: number | null }[];
    currency: string;
    due_in_days: number | null;
    issue_date: string | null;
  };
  contact: Contact | null;
  ares: AresPrefill | null;
}

export interface AiSettings {
  mode: 'off' | 'platform' | 'own';
  hasOwnKey: boolean;
  ownKeyLast4: string | null;
  platformAvailable: boolean;
  platformDailyLimit: number;
  model: string;
}

export type SelectedCustomer = { kind: 'contact'; id: string; contact: Contact } | { kind: 'ares'; ares: AresPrefill };

export type DocumentType = 'invoice' | 'proforma' | 'credit_note' | 'quote';
export type PaymentMethod = 'bank_transfer' | 'cash' | 'card' | 'cash_on_delivery' | 'other';
export type DocLanguage = 'cs' | 'sk' | 'en';

export interface FormItem {
  description: string;
  quantity: number;
  unit: string | null;
  /** Item / product code (SKU, EAN). */
  code: string | null;
  unitPrice: number;
  vatRate: number | null;
  discountPercent: number;
}

/** Everything the form sends; maps 1:1 onto the backend's `invoiceFieldsSchema`. */
export interface InvoiceDraftInput {
  /** null = no customer yet: fine for a draft (they can fill in their own details via a link), not for issuing. */
  customer: { kind: 'contact'; id: string } | { kind: 'ares'; ares: AresPrefill } | null;
  documentType: DocumentType;
  issueDate: string;
  dueDate: string;
  /** undefined = leave the stored value alone (the field is hidden, e.g. for a non-VAT payer). */
  taxableSupplyDate?: string;
  currency: string;
  /** CZK per unit, as typed; '' = ČNB rate at issue time. */
  exchangeRate: string;
  /** '' = automatic (account in the invoice currency, else the primary one). */
  bankAccountId: string;
  paymentMethod: PaymentMethod;
  /** Custom method (Settings → Způsoby úhrady); '' = the built-in name. */
  paymentMethodLabel: string;
  paymentInstructions: string;
  variableSymbol: string;
  constantSymbol: string;
  specificSymbol: string;
  orderNumber: string;
  language: DocLanguage;
  reverseCharge: boolean;
  /** Kód předmětu plnění (REVERSE_CHARGE_CODES); null = none chosen or not a domestic reverse charge. */
  reverseChargeCode: ReverseChargeCode | null;
  noteAbove: string;
  noteBelow: string;
  internalNote: string;
  issuePlace: string;
  issuedByName: string;
  customFields: CustomField[];
  /** Already received at creation (absolute amount), undefined = leave as is. */
  amountPaid?: number;
  items: FormItem[];
  prefilledByAi: boolean;
  templateId?: string | null;
}

export interface CustomField {
  label: string;
  value: string;
  /** text (may hold `{placeholders}`), amount in the document currency, % of the base, or a formula (`{base} - {naklady}`). */
  kind?: 'text' | 'amount' | 'percent' | 'formula';
  /** Team-only note: never printed, emailed or shown to the customer. */
  internal?: boolean;
}

/** Optional form fields a company can show expanded by default (Nastavení → Faktury). */
export const OPTIONAL_FIELDS = [
  'itemCode',
  'unit',
  'discount',
  'taxableSupplyDate',
  'symbols',
  'orderNumber',
  'issuePlace',
  'issuedBy',
  'noteAbove',
  'internalNote',
  'customFields',
  'language'
] as const;
export type OptionalField = (typeof OPTIONAL_FIELDS)[number];

/** Shown expanded when the company hasn't chosen otherwise. */
export const DEFAULT_SHOWN: Record<OptionalField, boolean> = {
  itemCode: false,
  unit: true,
  discount: true,
  taxableSupplyDate: true,
  symbols: false,
  orderNumber: false,
  issuePlace: false,
  issuedBy: false,
  noteAbove: false,
  internalNote: false,
  customFields: false,
  language: true
};

/** `tenants.invoice_form_prefs` as the backend stores it. */
export interface InvoiceFormPrefs {
  show: Record<OptionalField, boolean>;
  customFieldLabels: string[];
  defaultIssuePlace: string | null;
  defaultIssuedBy: string | null;
  /** Start the form in "prices incl. VAT" mode. */
  pricesIncludeVat: boolean;
  /** PDF accent colour, one of PDF_ACCENTS. */
  pdfAccent: string;
  /** Bilingual PDF: labels also in this language; null = off. */
  pdfSecondLanguage: 'cs' | 'sk' | 'en' | null;
  /** Automatic overdue reminders: on/off, days between them, at most this many. */
  remindersEnabled: boolean;
  reminderIntervalDays: number;
  reminderMax: number;
  /** What a blank new invoice starts with (Settings → Faktury → Výchozí hodnoty). */
  defaultCurrency: string | null;
  defaultBankAccountId: string | null;
  defaultContactId: string | null;
  defaultItems: DefaultItem[];
  defaultNoteAbove: string | null;
  /** Kurz u faktur v cizí měně (backend invoices/exchange-rate-mode.ts): what invoices print… */
  exchangeRateMode: ExchangeRateSetting;
  /** …and which rate reports and the income-tax estimate use. */
  reportRateMode: ReportRateMode;
  /** The company's own jednotný kurz per year, over the computed one. */
  annualRates: AnnualRate[];
  /** What customer links start with (backend public-links/public-link.ts). */
  publicLinkPrefix: PublicLinkPrefix;
}

export const PUBLIC_LINK_PREFIXES = ['number', 'company_number', 'none'] as const;
export type PublicLinkPrefix = (typeof PUBLIC_LINK_PREFIXES)[number];

/** Printed on invoices: the daily ČNB rate (§ 38 ZDPH), or no conversion (non-payers only). */
export type ExchangeRateSetting = 'cnb_daily' | 'none';
/** Reports and the income-tax estimate: each document's rate, or the jednotný kurz (§ 38 odst. 1 ZDP). */
export type ReportRateMode = 'daily' | 'annual';
/** Currencies the rate settings offer (and show a computed jednotný kurz for) by default. */
export const RATE_CURRENCIES = ['EUR', 'USD', 'GBP', 'PLN'];
/** What an issued document stored; null = issued before the setting existed. */
export type StoredRateMode = 'cnb_daily' | 'annual' | 'manual' | 'none';

/** One "jednotný kurz": CZK per 1 unit of `currency` for the calendar year. */
export interface AnnualRate {
  year: number;
  currency: string;
  rate: number;
}

/** A line item a blank invoice starts with. */
export interface DefaultItem {
  description: string;
  quantity: number;
  unit: string | null;
  unitPrice: number;
  vatRate: number | null;
}

/** Same list as the backend's `PDF_ACCENTS` (tenants/invoice-form-prefs.ts); first = default. */
export const PDF_ACCENTS = ['#4f46e5', '#2563eb', '#0d9488', '#16a34a', '#ea580c', '#e11d48', '#334155', '#111827'] as const;

/** Tenant-level defaults (Nastavení → Firma) the form starts from. */
export interface FormDefaults {
  prefs: InvoiceFormPrefs;
  /** Settings → Proměnné; the ones holding a number can be used in formula fields. */
  companyVars?: { key: string; value: string }[];
  vatPayer: boolean;
  dueDays: number;
  paymentMethod: PaymentMethod;
  /** Settings → Způsoby úhrady. */
  customPaymentMethods?: { id: string; label: string; base: PaymentMethod; instructions: string | null }[];
  noteBelow: string | null;
  language: DocLanguage;
  /** Blank invoice only (no template): customer, currency, account, items and note above to start with. */
  blank?: { contact: Contact | null; currency: string | null; bankAccountId: string | null; items: DefaultItem[]; noteAbove: string | null };
  /** Primary account (company profile) and the extra ones the invoice may be paid to. */
  primaryAccount: string | null;
  bankAccounts: { id: string; label: string; line: string; currency: string | null }[];
  /** Settings → Modules: whether quotes (cenové nabídky) are offered as a document type. */
  quotesEnabled: boolean;
  /** Seller country (ISO code); due-date warnings use its public holidays. */
  sellerCountry?: string;
}

/**
 * A starting point for the form: `GET /api/v1/invoices/:id/duplicate`, a
 * saved template, a contact alone ("new invoice for this customer") or — in
 * edit mode — the draft itself, which also carries its exact dates/symbols.
 */
export interface InvoiceTemplate {
  sourceNumber?: string | null;
  templateName?: string | null;
  contact: Contact | null;
  documentType?: DocumentType;
  currency?: string;
  exchangeRate?: number | null;
  bankAccountId?: string | null;
  dueInDays?: number | null;
  paymentMethod?: PaymentMethod;
  paymentMethodLabel?: string | null;
  paymentInstructions?: string | null;
  constantSymbol?: string | null;
  specificSymbol?: string | null;
  noteAbove?: string | null;
  noteBelow?: string | null;
  language?: DocLanguage;
  reverseCharge?: boolean;
  reverseChargeCode?: string | null;
  orderNumber?: string | null;
  issuePlace?: string | null;
  issuedByName?: string | null;
  customFields?: CustomField[];
  items?: { description: string; quantity: number; unit?: string | null; code?: string | null; unitPrice: number; vatRate: number | null; discountPercent?: number }[];
  // edit mode only
  issueDate?: string | null;
  dueDate?: string | null;
  taxableSupplyDate?: string | null;
  variableSymbol?: string | null;
  internalNote?: string | null;
}
