import { round2 } from "../invoices/invoice-total.util";
import { isOverdueDoc } from "./report-filters";

/** One document, already totalled, as the period report needs it. */
export interface StatsDoc {
  documentType: string;
  status: string;
  currency: string;
  language: string;
  /** DUZP, else issue date: the date revenue belongs to. */
  date: Date;
  issueDate: Date | null;
  dueDate: Date | null;
  paidAt: Date | null;
  contactId: string | null;
  contactName: string | null;
  /** Home currency per 1 unit of `currency`, stored at issue; null at home or when unknown. */
  exchangeRate: number | null;
  amountPaid: number;
  base: number;
  vat: number;
  total: number;
}

export interface StatsExpense {
  currency: string;
  date: Date;
  /** Without VAT. */
  base: number;
  exchangeRate: number | null;
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
  /** Still unpaid (with VAT, minus partial payments) on invoices and proformas dated in the period. */
  outstanding: number;
  outstandingCount: number;
  /** The overdue part of `outstanding`. */
  overdue: number;
  overdueCount: number;
  /** Customers invoiced in the period, and how many of them for the first time ever. */
  customerCount: number;
  newCustomers: number;
}

const DAY = 86_400_000;

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const pad = (n: number) => String(n).padStart(2, "0");
const dayKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Short ranges by day, a quarter or so by week (Monday), anything longer by month. */
/**
 * The first day the company has anything on record (an issued or paid
 * document or an expense), as a local midnight; null with no data. The
 * "Celkem" report runs from it.
 */
export function earliestDay(dates: Iterable<Date | null | undefined>): Date | null {
  let min: Date | null = null;
  for (const d of dates) if (d && !Number.isNaN(d.getTime()) && (!min || d < min)) min = d;
  return min ? startOfDay(min) : null;
}

/** YYYY-MM-DD of a local date. */
export const localDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

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
 * The factor that turns an amount in `currency` into the report currency:
 * 1 for the same currency, the stored rate for a foreign one when the report
 * is in the home currency (CZK, EUR for SK), null when it cannot be
 * converted (no stored rate).
 */
export function rateTo(currency: string, exchangeRate: number | null, reportCurrency: string, home = "CZK"): number | null {
  if (currency === reportCurrency) return 1;
  if (reportCurrency === home && exchangeRate != null && Number.isFinite(exchangeRate) && exchangeRate > 0) return exchangeRate;
  return null;
}

const isTaxDoc = (doc: StatsDoc) => doc.documentType === "invoice" || doc.documentType === "credit_note";
const isClaim = (doc: StatsDoc) => doc.documentType === "invoice" || doc.documentType === "proforma";
const unpaidPart = (doc: StatsDoc) => Math.max(0, doc.total - doc.amountPaid);

function countable(doc: StatsDoc) {
  return doc.status !== "draft" && doc.status !== "pending_review" && doc.status !== "cancelled" && doc.documentType !== "quote";
}

/**
 * Totals for [from, to) in the report currency. Same rules as the dashboard
 * cards: drafts, cancelled documents and quotes never count, proformas are
 * not revenue, credit notes subtract. Foreign-currency documents count at
 * their stored exchange rate; those without one are left out (and counted
 * by `periodBreakdown`, so the page can say so).
 */
export function periodTotals(
  docs: StatsDoc[],
  expenses: StatsExpense[],
  from: Date,
  to: Date,
  currency = "CZK",
  today = new Date(),
  home = "CZK",
): PeriodTotals {
  let revenue = 0;
  let vat = 0;
  let invoiceCount = 0;
  let collected = 0;
  let paidCount = 0;
  let payDays = 0;
  let outstanding = 0;
  let outstandingCount = 0;
  let overdue = 0;
  let overdueCount = 0;
  const customers = new Set<string>();
  // First invoice date per customer over everything loaded, for "new customers".
  const firstSeen = new Map<string, number>();
  for (const doc of docs) {
    if (!countable(doc)) continue;
    if (isTaxDoc(doc) && doc.contactId) {
      const seen = firstSeen.get(doc.contactId);
      if (seen == null || doc.date.getTime() < seen) firstSeen.set(doc.contactId, doc.date.getTime());
    }
    const rate = rateTo(doc.currency, doc.exchangeRate, currency, home);
    const inPeriod = within(doc.date, from, to);
    if (isTaxDoc(doc) && inPeriod && doc.contactId) customers.add(doc.contactId);
    if (rate == null) continue;
    if (isTaxDoc(doc) && inPeriod) {
      revenue += doc.base * rate;
      vat += doc.vat * rate;
      if (doc.documentType === "invoice") invoiceCount++;
    }
    if (doc.status === "paid" && doc.documentType !== "credit_note" && within(doc.paidAt, from, to)) {
      collected += doc.total * rate;
      paidCount++;
      if (doc.issueDate) payDays += Math.max(0, (startOfDay(doc.paidAt!).getTime() - startOfDay(doc.issueDate).getTime()) / DAY);
    }
    if (isClaim(doc) && inPeriod && doc.status === "issued") {
      const open = unpaidPart(doc) * rate;
      outstanding += open;
      outstandingCount++;
      if (isOverdueDoc(doc, today)) {
        overdue += open;
        overdueCount++;
      }
    }
  }
  let spent = 0;
  for (const e of expenses) {
    const rate = rateTo(e.currency, e.exchangeRate, currency, home);
    if (rate != null && within(e.date, from, to)) spent += e.base * rate;
  }
  let newCustomers = 0;
  for (const id of customers) if ((firstSeen.get(id) ?? 0) >= from.getTime()) newCustomers++;
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
    outstanding: round2(outstanding),
    outstandingCount,
    overdue: round2(overdue),
    overdueCount,
    customerCount: customers.size,
    newCustomers,
  };
}

/** How many customers the "by customer" pie names before folding the rest into "others". */
export const PIE_CUSTOMERS = 5;

/**
 * Revenue and expenses per bucket, the period's best customers and the
 * shares the pie charts show (by customer, currency, document type and
 * paid / unpaid / overdue), all in the report currency.
 */
export function periodBreakdown(
  docs: StatsDoc[],
  expenses: StatsExpense[],
  from: Date,
  to: Date,
  currency = "CZK",
  today = new Date(),
  home = "CZK",
) {
  const grain = grainFor(from, new Date(to.getTime() - 1));
  const series = new Map(bucketsBetween(from, new Date(to.getTime() - 1), grain).map((k) => [k, { start: k, revenue: 0, expenses: 0 }]));
  const customers = new Map<string, { contactId: string; name: string; total: number; count: number }>();
  const currencies = new Map<string, { currency: string; count: number; amount: number; converted: number | null }>();
  const types = new Map<string, { documentType: string; count: number; total: number }>();
  const payment = { paid: 0, unpaid: 0, overdue: 0 };
  let convertedCount = 0;
  let missingRateCount = 0;
  for (const doc of docs) {
    if (!countable(doc) || !within(doc.date, from, to)) continue;
    const rate = rateTo(doc.currency, doc.exchangeRate, currency, home);
    if (doc.currency !== currency) {
      if (rate == null) missingRateCount++;
      else convertedCount++;
    }
    const cur = currencies.get(doc.currency) ?? { currency: doc.currency, count: 0, amount: 0, converted: 0 };
    if (isTaxDoc(doc)) {
      cur.count++;
      cur.amount += doc.base;
      cur.converted = rate == null || cur.converted == null ? null : cur.converted + doc.base * rate;
      currencies.set(doc.currency, cur);
    }
    if (rate == null) continue;

    const type = types.get(doc.documentType) ?? { documentType: doc.documentType, count: 0, total: 0 };
    type.count++;
    // Credit notes are negative; the pie shows their size.
    type.total += Math.abs(doc.total * rate);
    types.set(doc.documentType, type);

    if (isClaim(doc)) {
      const paidPart = doc.status === "paid" ? doc.total : Math.min(doc.total, doc.amountPaid);
      payment.paid += Math.max(0, paidPart) * rate;
      if (doc.status === "issued") payment[isOverdueDoc(doc, today) ? "overdue" : "unpaid"] += unpaidPart(doc) * rate;
    }

    if (!isTaxDoc(doc)) continue;
    const bucket = series.get(bucketOf(doc.date, grain));
    if (bucket) bucket.revenue += doc.base * rate;
    if (doc.contactId) {
      const c = customers.get(doc.contactId) ?? { contactId: doc.contactId, name: doc.contactName ?? "–", total: 0, count: 0 };
      c.total += doc.base * rate;
      if (doc.documentType === "invoice") c.count++;
      customers.set(doc.contactId, c);
    }
  }
  for (const e of expenses) {
    const rate = rateTo(e.currency, e.exchangeRate, currency, home);
    if (rate == null || !within(e.date, from, to)) continue;
    const bucket = series.get(bucketOf(e.date, grain));
    if (bucket) bucket.expenses += e.base * rate;
  }
  const ranked = [...customers.values()].sort((a, b) => b.total - a.total);
  const others = ranked.slice(PIE_CUSTOMERS).reduce((s, c) => s + c.total, 0);
  return {
    grain,
    convertedCount,
    missingRateCount,
    series: [...series.values()].map((b) => ({ ...b, revenue: round2(b.revenue), expenses: round2(b.expenses) })),
    topCustomers: ranked.slice(0, 8).map((c) => ({ ...c, total: round2(c.total) })),
    byCustomer: [
      ...ranked.slice(0, PIE_CUSTOMERS).map((c) => ({ key: c.contactId, label: c.name, value: round2(c.total) })),
      ...(others > 0 ? [{ key: "others", label: null, value: round2(others) }] : []),
    ].filter((s) => s.value > 0),
    byCurrency: [...currencies.values()]
      .map((c) => ({ ...c, amount: round2(c.amount), converted: c.converted == null ? null : round2(c.converted) }))
      .sort((a, b) => (b.converted ?? 0) - (a.converted ?? 0)),
    byType: [...types.values()].map((t) => ({ ...t, total: round2(t.total) })).sort((a, b) => b.total - a.total),
    payment: { paid: round2(payment.paid), unpaid: round2(payment.unpaid), overdue: round2(payment.overdue) },
  };
}

/** Currencies, languages and customers present in the loaded documents, for the filter pickers. */
export function filterOptions(docs: StatsDoc[]) {
  const customers = new Map<string, string>();
  for (const d of docs) if (d.contactId) customers.set(d.contactId, d.contactName ?? "–");
  return {
    currencies: [...new Set(docs.map((d) => d.currency))].sort(),
    languages: [...new Set(docs.map((d) => d.language))].sort(),
    customers: [...customers].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, "cs")),
  };
}
