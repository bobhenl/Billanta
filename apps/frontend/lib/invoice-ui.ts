/**
 * Wire shapes and presentation helpers shared by the invoice list, the
 * invoice detail, the dashboard and the contact detail
 * (apps/backend/src/invoices/invoices.service.ts `list()` / `detail()`).
 */

export type InvoiceStatus = 'draft' | 'pending_review' | 'issued' | 'paid' | 'cancelled';
export type DocumentType = 'invoice' | 'proforma' | 'credit_note' | 'quote';
export type PaymentMethod = 'bank_transfer' | 'cash' | 'card' | 'cash_on_delivery' | 'other';
export type InvoiceSource = 'manual' | 'ai_telegram' | 'ai_whatsapp' | 'api' | 'recurring';

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
    reminderCount: number;
    lastReminderSentAt: string | null;
    publicViewCount: number;
    publicFirstViewedAt: string | null;
    publicLastViewedAt: string | null;
    clientResponse?: 'accepted' | 'rejected' | null;
    clientRespondedAt?: string | null;
    clientResponseName?: string | null;
    clientResponseNote?: string | null;
    customFields?: { label: string; value: string; kind?: 'text' | 'amount' | 'percent'; internal?: boolean }[] | null;
  };
  contact: {
    id: string;
    legalName: string;
    ico: string | null;
    dic: string | null;
    email: string | null;
    addressStreet: string | null;
    addressCity: string | null;
    addressPostalCode: string | null;
    addressCountry: string;
  } | null;
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
