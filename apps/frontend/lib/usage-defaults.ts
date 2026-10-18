// Client-safe (no next/headers): the dashboard and the reports page pick
// their defaults here from what the company actually uses.

/** `GET /dashboard/usage` (backend `dashboard/usage.ts`). */
export interface Usage {
  homeCurrency: string;
  currencies: { code: string; invoices: number; invoices12m: number; expenses: number; expenses12m: number }[];
  foreignCurrencies: string[];
  languages: string[];
  documents: { invoices: number; proformas: number; quotes: number; creditNotes: number; drafts: number; reverseCharge: number };
  expenses: { count: number; count12m: number };
  bank: { connections: number; activeConnections: number; bankApi: boolean; paypal: boolean; transactions: number; matched: number };
  recurringCount: number;
  templateCount: number;
  contactCount: number;
  unpaidCount: number;
  overdueCount: number;
  vatStatus: 'payer' | 'identified' | 'non_payer';
  accountType: 'company' | 'self_employed';
  has: {
    invoices: boolean;
    expenses: boolean;
    foreignCurrencies: boolean;
    multipleLanguages: boolean;
    bank: boolean;
    paypal: boolean;
    proformas: boolean;
    quotes: boolean;
    creditNotes: boolean;
    recurring: boolean;
    templates: boolean;
    vat: boolean;
  };
}

/** Dashboard keys that follow usage until the member saves their own choice. */
export const USAGE_DRIVEN_KEYS = ['cards', 'tiles', 'showFxRates', 'fxCurrencies'] as const;
export type UsageDrivenKey = (typeof USAGE_DRIVEN_KEYS)[number];

export const FALLBACK_FX = ['EUR', 'USD', 'GBP'];
export const FALLBACK_CARDS = ['revenue_month', 'unpaid', 'overdue', 'expenses_month'];
export const FALLBACK_TILES = ['new_invoice', 'new_expense', 'scan_invoice', 'templates', 'bank'];
const FX_LIMIT = 12;

export interface DashboardRecommendation {
  cards: string[];
  tiles: string[];
  showFxRates: boolean;
  fxCurrencies: string[];
}

/**
 * Defaults from usage. A brand new company (nothing issued yet) gets the
 * plain defaults, so every feature is still easy to find.
 */
export function recommendDashboard(usage: Usage | null): DashboardRecommendation {
  if (!usage || !usage.has.invoices) {
    return { cards: FALLBACK_CARDS, tiles: FALLBACK_TILES, showFxRates: !usage, fxCurrencies: FALLBACK_FX };
  }
  const { has } = usage;
  const cards = ['revenue_month', 'unpaid', 'overdue', has.expenses ? 'expenses_month' : 'revenue_year'];
  const tiles = ['new_invoice'];
  if (has.proformas) tiles.push('new_proforma');
  if (has.quotes) tiles.push('new_quote');
  if (has.expenses) tiles.push('new_expense', 'scan_invoice');
  if (has.templates || has.recurring) tiles.push('templates');
  if (has.bank) tiles.push(usage.bank.bankApi || has.paypal ? 'bank_sync' : 'bank');
  if (tiles.length < 3) tiles.push('new_contact');
  return {
    cards,
    tiles,
    showFxRates: has.foreignCurrencies,
    fxCurrencies: has.foreignCurrencies ? usage.foreignCurrencies.slice(0, FX_LIMIT) : FALLBACK_FX
  };
}

/** Saved keys win; the rest come from the recommendation. `null` lists mean "recommended" too. */
export function withUsageDefaults<T extends Partial<Record<UsageDrivenKey, unknown>>>(config: T, savedKeys: readonly string[] | undefined, rec: DashboardRecommendation): T {
  // An older backend sends no savedKeys: treat everything it returned as chosen.
  const saved = new Set(savedKeys ?? (Object.keys(config) as string[]));
  const next = { ...config } as Record<string, unknown>;
  for (const key of USAGE_DRIVEN_KEYS) {
    if (!saved.has(key) || next[key] == null) next[key] = rec[key];
  }
  return next as T;
}

/** KPI cards on the reports page, in their default order. */
export const REPORT_KPIS = [
  'revenue',
  'expenses',
  'profit',
  'collected',
  'invoiceCount',
  'averageInvoice',
  'vat',
  'daysToPay',
  'outstanding',
  'overdue',
  'customers',
  'newCustomers'
] as const;
export type ReportKpi = (typeof REPORT_KPIS)[number];
export const EXPENSE_KPIS: ReportKpi[] = ['expenses', 'profit'];

/** VAT only for a payer (or an identified person with reverse-charge data); expenses / profit only when expenses exist. */
export function recommendReportKpis(usage: Usage | null): ReportKpi[] {
  if (!usage) return [...REPORT_KPIS];
  return REPORT_KPIS.filter((k) => (k === 'vat' ? usage.has.vat : EXPENSE_KPIS.includes(k) ? usage.has.expenses : true));
}

/** The member's saved list in their order (unknown ids and repeats dropped), else the recommendation. */
export function reportKpisOf(saved: readonly string[] | null | undefined, usage: Usage | null): ReportKpi[] {
  if (!saved) return recommendReportKpis(usage);
  return [...new Set(saved)].filter((k): k is ReportKpi => (REPORT_KPIS as readonly string[]).includes(k));
}
