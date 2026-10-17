import type { DocumentType, InvoiceStatus } from '@/lib/invoice-ui';

/** KPI cards the backend computes (`DASHBOARD_WIDGETS`), in the default order. */
export const KPI_CARDS = ['revenue_month', 'unpaid', 'overdue', 'expenses_month', 'revenue_year', 'drafts', 'profit_month', 'vat_month', 'due_soon', 'unviewed', 'missing_receipts'] as const;
export type KpiCard = (typeof KPI_CARDS)[number];

/** Quick-action tiles (frontend-defined ids, stored per member). */
export const QUICK_TILES = ['new_invoice', 'new_proforma', 'new_quote', 'new_expense', 'scan_invoice', 'dictate_invoice', 'templates', 'bulk', 'new_contact', 'bank', 'bank_sync', 'exports', 'calendar_feed', 'public_profile', 'migration'] as const;
export type QuickTile = (typeof QUICK_TILES)[number];
export const DEFAULT_TILES: QuickTile[] = ['new_invoice', 'new_expense', 'scan_invoice', 'templates', 'bank'];

export interface DashboardConfig {
  cards: KpiCard[];
  tiles: string[] | null;
  showChart: boolean;
  showRecent: boolean;
  showTopCustomers: boolean;
  showDueSoon: boolean;
  showTaxDeadlines: boolean;
  /** null = defaults for the company's VAT status (lib/tax-deadlines.ts). */
  taxDeadlines: string[] | null;
  showFxRates: boolean;
  /** ČNB rate cards; null = the foreign currencies the company uses (else EUR, USD, GBP). */
  fxCurrencies: string[] | null;
  /** Expected amount per tax-deadline kind, typed in by the member (their own advances); null = none. */
  taxAmounts: Record<string, number> | null;
  /** KPI cards on the reports page; null = picked from usage (lib/usage-defaults.ts). */
  reportKpis?: string[] | null;
  /** Keys the member saved themselves; everything else follows usage. Missing on an older backend. */
  savedKeys?: string[];
}

/** What PUT /dashboard/config takes: null on a key forgets the saved choice (back to the usage-based default). */
export type DashboardConfigPatch = { [K in keyof Omit<DashboardConfig, 'savedKeys'>]?: DashboardConfig[K] | null };

export interface DashboardDoc {
  id: string;
  documentType: DocumentType;
  invoiceNumber: string | null;
  status: InvoiceStatus;
  issueDate: string | null;
  dueDate: string | null;
  currency: string;
  contactName: string | null;
  contactColor?: string | null;
  total: number;
  isOverdue: boolean;
}

export interface DashboardSummary {
  currency: string;
  kpi: {
    revenueMonth: number;
    revenueYear: number;
    vatMonth: number;
    unpaidTotal: number;
    unpaidCount: number;
    overdueTotal: number;
    overdueCount: number;
    draftCount: number;
    expensesMonth: number;
    profitMonth: number;
    dueSoonTotal: number;
    dueSoonCount: number;
    unviewedCount: number;
    missingReceiptsCount: number;
  };
  foreignCurrencyCount: number;
  chart: { month: string; revenue: number; expenses: number }[];
  recent: DashboardDoc[];
  overdue: DashboardDoc[];
  /** Optional so an older backend without it still renders. */
  dueSoon?: DashboardDoc[];
  topCustomers: { contactId: string; name: string; total: number; count: number }[];
}

export interface PeriodTotals {
  revenue: number;
  vat: number;
  expenses: number;
  profit: number;
  invoiceCount: number;
  averageInvoice: number;
  collected: number;
  paidCount: number;
  averageDaysToPay: number | null;
  /** Unpaid rest (with VAT) of invoices and proformas dated in the period, and its overdue part. */
  outstanding: number;
  outstandingCount: number;
  overdue: number;
  overdueCount: number;
  customerCount: number;
  newCustomers: number;
}

export const REPORT_STATUSES = ['paid', 'unpaid', 'overdue', 'cancelled'] as const;
export const REPORT_DOC_TYPES = ['invoice', 'proforma', 'credit_note'] as const;

/** Optional report filters (`GET /dashboard/stats` and the invoice CSV take the same query keys). */
export type ReportFilters = {
  currency?: string;
  language?: string;
  contactId?: string;
  documentType?: (typeof REPORT_DOC_TYPES)[number];
  status?: (typeof REPORT_STATUSES)[number];
};

/** `GET /dashboard/stats`: one period against the same-length period before it. */
export interface PeriodStats {
  currency: string;
  from: string;
  to: string;
  current: PeriodTotals;
  previous: PeriodTotals;
  grain: 'day' | 'week' | 'month';
  filters: ReportFilters;
  /** False when a customer / type / status / language filter is on: expenses are then not filtered. */
  expensesFiltered: boolean;
  options: { currencies: string[]; languages: string[]; customers: { id: string; name: string }[] };
  /** Foreign-currency documents counted at their stored rate, and those left out for lack of one. */
  convertedCount: number;
  missingRateCount: number;
  series: { start: string; revenue: number; expenses: number }[];
  topCustomers: { contactId: string; name: string; total: number; count: number }[];
  /** Top customers by revenue; key "others" (label null) is the rest together. */
  byCustomer: { key: string; label: string | null; value: number }[];
  /** Revenue without VAT per original currency; `converted` is null when some lacked a rate. */
  byCurrency: { currency: string; count: number; amount: number; converted: number | null }[];
  /** Amount with VAT per document type (credit notes as a positive size). */
  byType: { documentType: string; count: number; total: number }[];
  payment: { paid: number; unpaid: number; overdue: number };
}
