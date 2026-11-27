import { periodReport, type ReportFilters, type StatsDoc, type StatsExpense } from './report-stats.js';
import type { DocumentAmounts } from './vault-amounts.js';

/*
 * Dashboard and period report with sealed amounts (Důvěrný režim, category
 * "amounts"). The server leaves those documents out of every sum and sends
 * what it knows about them; after unlock the browser opens their totals and
 * merges them here. Nothing opened goes back to the server.
 */

const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

/**
 * One sealed document for the dashboard home. The server decides every date
 * rule (this month, this year, overdue, due soon) so the browser's clock and
 * time zone cannot move a document between buckets.
 */
export interface SealedSummaryDoc {
  id: string;
  encAmounts: string;
  contactId: string | null;
  contactName: string | null;
  amountPaid: number;
  /** Issued, not a credit note: counts towards "unpaid". */
  unpaid: boolean;
  overdue: boolean;
  dueSoon: boolean;
  /** An invoice or a credit note: counts as revenue. */
  taxDoc: boolean;
  inMonth: boolean;
  inYear: boolean;
  /** The chart bucket (YYYY-MM). */
  month: string;
}

export interface SummaryKpi {
  revenueMonth: number;
  revenueYear: number;
  vatMonth: number;
  unpaidTotal: number;
  overdueTotal: number;
  expensesMonth: number;
  profitMonth: number;
  dueSoonTotal?: number;
}

export interface SummaryCustomer {
  contactId: string;
  name: string;
  total: number;
  count: number;
}

/** How many customers the dashboard lists (the server's `topCustomers`). */
export const SUMMARY_TOP_CUSTOMERS = 5;

/**
 * The dashboard's sums with the opened sealed documents added, by the same
 * rules as `DashboardService.summary`. `customers` is the server's full list
 * of the year's customers, so a customer who only climbs into the top five
 * with a sealed document still shows. `missing` counts the documents this
 * key could not open: they stay out, and the page says so.
 */
export function mergeSealedSummary<K extends SummaryKpi>(
  base: { kpi: K; chart: { month: string; revenue: number; expenses: number }[]; customers: SummaryCustomer[] },
  docs: SealedSummaryDoc[],
  opened: ReadonlyMap<string, DocumentAmounts>,
): { kpi: K; chart: { month: string; revenue: number; expenses: number }[]; topCustomers: SummaryCustomer[]; missing: number } {
  const kpi = { ...base.kpi };
  const chart = base.chart.map((m) => ({ ...m }));
  const customers = new Map(base.customers.map((c) => [c.contactId, { ...c }]));
  let missing = 0;
  for (const doc of docs) {
    const totals = opened.get(doc.encAmounts);
    if (!totals) {
      missing++;
      continue;
    }
    const open = Math.max(0, round2(totals.totalWithVat - doc.amountPaid));
    if (doc.dueSoon) kpi.dueSoonTotal = (kpi.dueSoonTotal ?? 0) + open;
    if (doc.unpaid) {
      kpi.unpaidTotal += open;
      if (doc.overdue) kpi.overdueTotal += open;
    }
    if (!doc.taxDoc) continue;
    if (doc.inMonth) {
      kpi.revenueMonth += totals.totalWithoutVat;
      kpi.vatMonth += totals.totalVat;
    }
    if (doc.inYear) {
      kpi.revenueYear += totals.totalWithoutVat;
      if (doc.contactId) {
        const c = customers.get(doc.contactId) ?? { contactId: doc.contactId, name: doc.contactName ?? '–', total: 0, count: 0 };
        c.total += totals.totalWithoutVat;
        c.count++;
        customers.set(doc.contactId, c);
      }
    }
    const bucket = chart.find((m) => m.month === doc.month);
    if (bucket) bucket.revenue += totals.totalWithoutVat;
  }
  kpi.profitMonth = kpi.revenueMonth - kpi.expensesMonth;
  for (const k of ['revenueMonth', 'revenueYear', 'vatMonth', 'unpaidTotal', 'overdueTotal', 'profitMonth', 'dueSoonTotal'] as const) {
    if (kpi[k] != null) kpi[k] = round2(kpi[k]!);
  }
  return {
    kpi,
    chart: chart.map((m) => ({ ...m, revenue: round2(m.revenue) })),
    topCustomers: [...customers.values()]
      .sort((a, b) => b.total - a.total)
      .slice(0, SUMMARY_TOP_CUSTOMERS)
      .map((c) => ({ ...c, total: round2(c.total) })),
    missing,
  };
}

type Wire<T> = { [P in keyof T]: T[P] extends Date ? string : T[P] extends Date | null ? string | null : T[P] };

/** A sealed document for the period report: a `StatsDoc` without its amounts. */
export type SealedStatsDoc = Omit<StatsDoc, 'base' | 'vat' | 'total'> & { id: string; encAmounts: string };

/** What `GET /dashboard/stats` sends next to the sealed ids, as JSON (dates as ISO strings). */
export interface SealedStatsInputs {
  home: string;
  previousFrom: string;
  docs: Wire<StatsDoc>[];
  sealedDocs: Wire<SealedStatsDoc>[];
  expenses: Wire<StatsExpense>[];
}

const date = (v: string) => new Date(v);
const dateOrNull = (v: string | null) => (v == null ? null : new Date(v));

function reviveDoc<T extends Wire<Omit<StatsDoc, 'base' | 'vat' | 'total'>>>(d: T) {
  return { ...d, date: date(d.date), issueDate: dateOrNull(d.issueDate), dueDate: dateOrNull(d.dueDate), paidAt: dateOrNull(d.paidAt) };
}

/**
 * The period report rerun over the plain documents plus the opened sealed
 * ones, with the server's own `periodReport`. Same filters, period and
 * currency as the server's answer; `missing` sealed documents (another key,
 * a broken envelope) stay out.
 */
export function mergeSealedStats(
  inputs: SealedStatsInputs,
  opened: ReadonlyMap<string, DocumentAmounts>,
  opts: { from: string; to: string; currency: string; filters: ReportFilters; today?: Date },
) {
  const docs: StatsDoc[] = inputs.docs.map((d) => ({ ...reviveDoc(d), base: d.base, vat: d.vat, total: d.total }));
  let missing = 0;
  for (const s of inputs.sealedDocs) {
    const totals = opened.get(s.encAmounts);
    if (!totals) {
      missing++;
      continue;
    }
    const { id: _id, encAmounts: _enc, ...rest } = reviveDoc(s);
    docs.push({ ...rest, base: totals.totalWithoutVat, vat: totals.totalVat, total: totals.totalWithVat });
  }
  const expenses: StatsExpense[] = inputs.expenses.map((e) => ({ ...e, date: date(e.date) }));
  // The server's `to` is the last millisecond of the period; the maths wants the exclusive end.
  const to = new Date(new Date(opts.to).getTime() + 1);
  const report = periodReport(docs, expenses, {
    from: new Date(opts.from),
    to,
    previousFrom: new Date(inputs.previousFrom),
    currency: opts.currency,
    home: inputs.home,
    filters: opts.filters,
    today: opts.today,
  });
  return { ...report, missing };
}
