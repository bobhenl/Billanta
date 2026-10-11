import { round2 } from "../invoices/invoice-total.util";

/** One document, already totalled, as the period report needs it. */
export interface StatsDoc {
  documentType: string;
  status: string;
  currency: string;
  /** DUZP, else issue date: the date revenue belongs to. */
  date: Date;
  issueDate: Date | null;
  paidAt: Date | null;
  contactId: string | null;
  contactName: string | null;
  base: number;
  vat: number;
  total: number;
}

export interface StatsExpense {
  currency: string;
  date: Date;
  /** Without VAT. */
  base: number;
}

export type StatsGrain = "day" | "week" | "month";

export interface PeriodTotals {
  revenue: number;
  vat: number;
  expenses: number;
  profit: number;
  /** Invoices (not credit notes) issued in the period. */
  invoiceCount: number;
  averageInvoice: number;
  /** Paid in the period, whenever issued, with VAT. */
  collected: number;
  paidCount: number;
  /** Average days from issue to payment over invoices paid in the period; null if none. */
  averageDaysToPay: number | null;
}

const DAY = 86_400_000;

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const pad = (n: number) => String(n).padStart(2, "0");
const dayKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Short ranges by day, a quarter or so by week (Monday), anything longer by month. */
export function grainFor(from: Date, to: Date): StatsGrain {
  const days = Math.round((startOfDay(to).getTime() - startOfDay(from).getTime()) / DAY) + 1;
  if (days <= 45) return "day";
  if (days <= 120) return "week";
  return "month";
}

/** The bucket a date falls into, as the bucket's first day (YYYY-MM-DD). */
export function bucketOf(d: Date, grain: StatsGrain): string {
  if (grain === "month") return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-01`;
  if (grain === "week") {
    const monday = startOfDay(d);
    monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
    return dayKey(monday);
  }
  return dayKey(d);
}

/** Every bucket key between from and to, so empty days / weeks / months still get a bar. */
export function bucketsBetween(from: Date, to: Date, grain: StatsGrain): string[] {
  const keys: string[] = [];
  const cursor = startOfDay(from);
  const end = startOfDay(to);
  while (cursor <= end) {
    const key = bucketOf(cursor, grain);
    if (keys[keys.length - 1] !== key) keys.push(key);
    if (grain === "month") cursor.setMonth(cursor.getMonth() + 1, 1);
    else cursor.setDate(cursor.getDate() + (grain === "week" ? 7 - ((cursor.getDay() + 6) % 7) : 1));
  }
  return keys;
}

const within = (d: Date | null, from: Date, to: Date) => !!d && d >= from && d < to;

/**
 * Totals for [from, to) in the home currency. Same rules as the dashboard
 * cards: drafts, cancelled documents and quotes never count, proformas are
 * not revenue, credit notes subtract, and other currencies are left out
 * (and counted, so the page can say so).
 */
export function periodTotals(docs: StatsDoc[], expenses: StatsExpense[], from: Date, to: Date, currency = "CZK"): PeriodTotals {
  let revenue = 0;
  let vat = 0;
  let invoiceCount = 0;
  let collected = 0;
  let paidCount = 0;
  let payDays = 0;
  for (const doc of docs) {
    if (doc.currency !== currency || !countable(doc)) continue;
    const taxDoc = doc.documentType === "invoice" || doc.documentType === "credit_note";
    if (taxDoc && within(doc.date, from, to)) {
      revenue += doc.base;
      vat += doc.vat;
      if (doc.documentType === "invoice") invoiceCount++;
    }
    if (doc.status === "paid" && doc.documentType !== "credit_note" && within(doc.paidAt, from, to)) {
      collected += doc.total;
      paidCount++;
      if (doc.issueDate) payDays += Math.max(0, (startOfDay(doc.paidAt!).getTime() - startOfDay(doc.issueDate).getTime()) / DAY);
    }
  }
  const spent = expenses.filter((e) => e.currency === currency && within(e.date, from, to)).reduce((s, e) => s + e.base, 0);
  return {
    revenue: round2(revenue),
    vat: round2(vat),
    expenses: round2(spent),
    profit: round2(revenue - spent),
    invoiceCount,
    averageInvoice: invoiceCount ? round2(revenue / invoiceCount) : 0,
    collected: round2(collected),
    paidCount,
    averageDaysToPay: paidCount ? Math.round((payDays / paidCount) * 10) / 10 : null,
  };
}

function countable(doc: StatsDoc) {
  return doc.status !== "draft" && doc.status !== "pending_review" && doc.status !== "cancelled" && doc.documentType !== "quote";
}

/** Revenue and expenses per bucket, and the period's best customers. */
export function periodBreakdown(docs: StatsDoc[], expenses: StatsExpense[], from: Date, to: Date, currency = "CZK") {
  const grain = grainFor(from, new Date(to.getTime() - 1));
  const series = new Map(bucketsBetween(from, new Date(to.getTime() - 1), grain).map((k) => [k, { start: k, revenue: 0, expenses: 0 }]));
  const customers = new Map<string, { contactId: string; name: string; total: number; count: number }>();
  let foreignCount = 0;
  for (const doc of docs) {
    if (!countable(doc) || !within(doc.date, from, to)) continue;
    if (doc.documentType !== "invoice" && doc.documentType !== "credit_note") continue;
    if (doc.currency !== currency) {
      foreignCount++;
      continue;
    }
    const bucket = series.get(bucketOf(doc.date, grain));
    if (bucket) bucket.revenue += doc.base;
    if (doc.contactId) {
      const c = customers.get(doc.contactId) ?? { contactId: doc.contactId, name: doc.contactName ?? "–", total: 0, count: 0 };
      c.total += doc.base;
      if (doc.documentType === "invoice") c.count++;
      customers.set(doc.contactId, c);
    }
  }
  for (const e of expenses) {
    if (e.currency !== currency || !within(e.date, from, to)) continue;
    const bucket = series.get(bucketOf(e.date, grain));
    if (bucket) bucket.expenses += e.base;
  }
  return {
    grain,
    foreignCount,
    series: [...series.values()].map((b) => ({ ...b, revenue: round2(b.revenue), expenses: round2(b.expenses) })),
    topCustomers: [...customers.values()]
      .sort((a, b) => b.total - a.total)
      .slice(0, 8)
      .map((c) => ({ ...c, total: round2(c.total) })),
  };
}
