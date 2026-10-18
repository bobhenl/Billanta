/**
 * Wire shapes and presentation helpers shared by the invoice list, the
 * invoice detail, the dashboard and the contact detail
 * (apps/backend/src/invoices/invoices.service.ts `list()` / `detail()`).
 */

export type InvoiceStatus = 'draft' | 'pending_review' | 'issued' | 'paid' | 'cancelled';
export type DocumentType = 'invoice' | 'proforma' | 'credit_note' | 'quote';
export type PaymentMethod = 'bank_transfer' | 'cash' | 'card' | 'cash_on_delivery' | 'other';
export type InvoiceSource = 'manual' | 'ai_telegram' | 'ai_whatsapp' | 'api' | 'recurring' | 'import' | 'profile_order';

export const DOCUMENT_TYPES: DocumentType[] = ['invoice', 'proforma', 'credit_note', 'quote'];
export const INVOICE_STATUSES: InvoiceStatus[] = ['draft', 'pending_review', 'issued', 'paid', 'cancelled'];

export interface InvoiceRow {
  id: string;
  documentType: DocumentType;
  invoiceNumber: string | null;
  variableSymbol: string | null;
  orderNumber: string | null;
  currency: string;
  status: InvoiceStatus;
  source: InvoiceSource;
  issueDate: string | null;
  dueDate: string | null;
  taxableSupplyDate: string | null;
  /** CZK per 1 unit of `currency` (ČNB rate stored at issue); null for CZK. */
  exchangeRate?: string | null;
  /** How the rate was chosen at issue (Settings → Faktury → Kurz); null = issued before the setting. */
  exchangeRateMode?: 'cnb_daily' | 'annual' | 'manual' | 'none' | null;
  /** ČNB list day (cnb_daily) or 1 January of the rate's year (annual), YYYY-MM-DD. */
  exchangeRateDate?: string | null;
  paidAt: string | null;
  /** Sum received so far (numeric string); equals the total once paid. */
  amountPaid?: string;
  sentAt: string | null;
  createdAt: string;
  contactId: string | null;
  contactName: string | null;
  contactIco: string | null;
  contactColor?: string | null;
  totalWithoutVat: number;
  totalVat: number;
  total: number;
  isOverdue: boolean;
  /** Open "customer fills in their details" link on a draft (null when none). */
  buyerDetailsToken?: string | null;
  buyerDetailsSubmittedAt?: string | null;
}

export interface BuyerDetailsOutcome {
  mode: 'existing' | 'filled' | 'created';
  contactId: string;
  filled: string[];
  conflicts: { field: string; saved: string | null; submitted: string | null }[];
  autoIssue: 'issued' | 'sent' | 'skipped' | 'failed' | null;
  autoIssueError?: string | null;
}

/**
 * Which wording the CZK conversion of a foreign-currency document gets, the
 * same as its PDF (backend invoices/exchange-rate-mode.ts `rateLineLabel`):
 * `on` = ČNB rate of a given day, `annual` = the company's rate for a year,
 * `manual` = a typed rate, `hidden` = not printed, `legacy` = before the setting.
 */
export function fxLabelOf(row: {
  exchangeRateMode?: InvoiceRow['exchangeRateMode'];
  exchangeRateDate?: string | null;
  taxableSupplyDate?: string | null;
  issueDate?: string | null;
}): { kind: 'on'; date: string } | { kind: 'annual'; year: string } | { kind: 'manual' | 'hidden' | 'legacy' } {
  const fallback = row.taxableSupplyDate ?? row.issueDate ?? null;
  switch (row.exchangeRateMode) {
    case 'none':
      return { kind: 'hidden' };
    case 'manual':
      return { kind: 'manual' };
    case 'annual':
      return { kind: 'annual', year: (row.exchangeRateDate ?? fallback ?? '').slice(0, 4) };
    case 'cnb_daily': {
      const date = row.exchangeRateDate ?? fallback;
      return date ? { kind: 'on', date } : { kind: 'legacy' };
    }
    default:
      return { kind: 'legacy' };
  }
}

/** The draft is waiting for the customer, or the customer has filled in their details and it still is a draft. */
export function buyerDetailsState(row: { status: string; buyerDetailsToken?: string | null; buyerDetailsSubmittedAt?: string | null }): 'waiting' | 'submitted' | null {
  if (row.status !== 'draft' && row.status !== 'pending_review') return null;
  if (row.buyerDetailsSubmittedAt) return 'submitted';
  return row.buyerDetailsToken ? 'waiting' : null;
}

export interface InvoiceDetail {
  invoice: Omit<InvoiceRow, 'contactName' | 'contactIco' | 'totalWithoutVat' | 'totalVat' | 'total'> & {
    constantSymbol: string | null;
    specificSymbol: string | null;
    paymentMethod: PaymentMethod;
    paymentMethodLabel?: string | null;
    paymentInstructions?: string | null;
    noteAbove: string | null;
    noteBelow: string | null;
    internalNote: string | null;
    language: string;
    reverseCharge: boolean;
    exchangeRate: string | null;
    paymentFees?: string;
    receivedCzk?: string | null;
    bankAccountId: string | null;
    relatedInvoiceId: string | null;
    issuedAt: string | null;
    cancelledAt: string | null;
    publicToken: string;
    /** The user's own name in front of the link key; null = the Settings prefix. */
    publicSlug?: string | null;
    reminderCount: number;
    lastReminderSentAt: string | null;
    publicViewCount: number;
    publicFirstViewedAt: string | null;
    publicLastViewedAt: string | null;
    clientResponse?: 'accepted' | 'rejected' | null;
    clientRespondedAt?: string | null;
    clientResponseName?: string | null;
    clientResponseNote?: string | null;
    buyerDetailsRequestedAt?: string | null;
    buyerDetailsEmail?: string | null;
    buyerDetailsAutoIssue?: boolean;
    buyerDetailsRequired?: ('email' | 'phone' | 'ico' | 'dic')[] | null;
    buyerDetailsOutcome?: BuyerDetailsOutcome | null;
    customFields?: { label: string; value: string; kind?: 'text' | 'amount' | 'percent'; internal?: boolean }[] | null;
  };
  /** The live contact (link, e-mail for sending). */
  contact: InvoiceParty | null;
  /** Customer link path segments with the readable prefix (/i/, /c/, /d/). */
  links?: { public: string; publicDefault?: string; portal: string | null; buyerDetails: string | null };
  /** The buyer as printed on the document: its issue-date snapshot when it has one. */
  buyer?: Omit<InvoiceParty, 'id'> | null;
  /** True when the issue-date snapshot differs from today's company details / contact. */
  snapshot?: { sellerDiffers: boolean; buyerDiffers: boolean };
  items: {
    id: string;
    description: string;
    quantity: string;
    unit: string | null;
    unitPrice: string;
    vatRate: string | null;
    discountPercent: string;
    lineTotalWithoutVat: number;
  }[];
  totals: {
    totalWithoutVat: number;
    totalVat: number;
    totalWithVat: number;
    byRate: { vatRatePercent: number; totalWithoutVat: number; vatAmount: number; totalWithVat: number }[];
  };
  parent: RelatedDoc | null;
  children: RelatedDoc[];
}

export interface InvoiceParty {
  id: string;
  legalName: string;
  ico: string | null;
  dic: string | null;
  email: string | null;
  addressStreet: string | null;
  addressCity: string | null;
  addressPostalCode: string | null;
  addressCountry: string;
}

export interface RelatedDoc {
  id: string;
  documentType: DocumentType;
  invoiceNumber: string | null;
  status: InvoiceStatus;
  issueDate: string | null;
}

export const STATUS_BADGE_CLASSES: Record<InvoiceStatus | 'overdue', string> = {
  draft: 'bg-muted text-muted-foreground',
  pending_review: 'bg-warning/15 text-warning',
  issued: 'bg-accent text-accent-foreground',
  paid: 'bg-success/15 text-success',
  cancelled: 'bg-destructive/10 text-destructive line-through',
  overdue: 'bg-destructive/15 text-destructive'
};

export const TYPE_BADGE_CLASSES: Record<DocumentType, string> = {
  invoice: 'bg-primary/10 text-primary',
  proforma: 'bg-warning/15 text-warning',
  credit_note: 'bg-destructive/10 text-destructive',
  quote: 'bg-muted text-muted-foreground'
};

/** Which conversions the backend's `POST /:id/convert` accepts from each type. */
export const CONVERSIONS: Record<DocumentType, Exclude<DocumentType, 'quote'>[]> = {
  quote: ['invoice', 'proforma'],
  proforma: ['invoice'],
  invoice: ['credit_note'],
  credit_note: []
};

/** The badge to show: an issued document past its due date reads "overdue". */
export function displayStatus(row: { status: InvoiceStatus; isOverdue: boolean }): InvoiceStatus | 'overdue' {
  return row.isOverdue ? 'overdue' : row.status;
}

export function formatMoney(amount: number, currency: string, locale: string): string {
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency, maximumFractionDigits: 2 }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

export function formatDate(value: string | null | undefined, locale: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return isNaN(date.getTime()) ? null : new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(date);
}
