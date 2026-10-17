import { Injectable } from "@nestjs/common";
import { and, count, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "../../drizzle/schema";
import { isOverdue } from "../invoices/invoices.service";
import { computeVatBreakdown, round2 } from "../invoices/invoice-total.util";
import { filterOptions, periodBreakdown, periodTotals, type StatsDoc, type StatsExpense } from "./period-stats";
import { hasDocumentFilters, matchesFilters, type ReportFilters } from "./report-filters";
import { summarizeUsage, type Usage } from "./usage";
import { vatActivity, type VatActivity } from "./vat-activity";

type Db = PostgresJsDatabase<typeof schema>;
type LineItemRow = typeof schema.invoiceLineItems.$inferSelect;

/** Tiles a member can pin to the dashboard, in the default order. */
export const DASHBOARD_WIDGETS = [
  "revenue_month",
  "unpaid",
  "overdue",
  "expenses_month",
  "revenue_year",
  "drafts",
  "profit_month",
  "vat_month",
  "due_soon",
  "unviewed",
  "missing_receipts",
] as const;

export const DEFAULT_DASHBOARD_CONFIG = {
  // KPI cards shown at the top.
  cards: ["revenue_month", "unpaid", "overdue", "expenses_month"] as string[],
  // Quick-action shortcuts (ids are frontend-defined).
  tiles: null as string[] | null,
  showChart: true,
  showRecent: true,
  showTopCustomers: true,
  showDueSoon: true,
  showTaxDeadlines: true,
  // Tax-deadline kinds (frontend lib/tax-deadlines.ts); null = derived from the VAT-payer flag.
  taxDeadlines: null as string[] | null,
  showFxRates: true,
  // ČNB rate cards; null = the currencies the company uses (frontend), else EUR, USD, GBP.
  fxCurrencies: null as string[] | null,
  // The member's own expected amount per tax-deadline kind (e.g. their insurance advance); null = none.
  taxAmounts: null as Record<string, number> | null,
  // KPI cards on the reports page (frontend ids); null = picked from what the company uses.
  reportKpis: null as string[] | null,
};

/** "Due soon" = issued, not yet overdue, due within this many days. */
export const DUE_SOON_DAYS = 7;

export type DashboardConfig = typeof DEFAULT_DASHBOARD_CONFIG;

function monthKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * Everything the dashboard home shows, computed in one pass. Amounts are in
 * the tenant's home currency (CZK); documents in other currencies are
 * counted but not summed, and surfaced in `foreignCurrencyCount`.
 */
@Injectable()
export class DashboardService {
  async summary(db: Db) {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const yearStart = new Date(now.getFullYear(), 0, 1);
    const chartStart = new Date(now.getFullYear(), now.getMonth() - 11, 1);

    const invoices = await db
      .select({ invoice: schema.invoices, contactName: schema.contacts.legalName, contactColor: schema.contacts.color })
      .from(schema.invoices)
      .leftJoin(schema.contacts, eq(schema.contacts.id, schema.invoices.contactId))
      .orderBy(desc(schema.invoices.createdAt));

    const ids = invoices.map((r) => r.invoice.id);
    const items = ids.length
      ? await db.select().from(schema.invoiceLineItems).where(inArray(schema.invoiceLineItems.invoiceId, ids))
      : [];
    const byInvoice = new Map<string, LineItemRow[]>();
    for (const item of items) {
      const list = byInvoice.get(item.invoiceId) ?? [];
      list.push(item);
      byInvoice.set(item.invoiceId, list);
    }

    const expenses = await db
      .select()
      .from(schema.expenses)
      .where(gte(schema.expenses.expenseDate, chartStart));

    // All of them, so the card matches the /expenses?receipt=no list it links to.
    const [{ n: missingReceipts }] = await db
      .select({ n: count() })
      .from(schema.expenses)
      .where(isNull(schema.expenses.receiptFileUrl));

    const months = new Map<string, { month: string; revenue: number; expenses: number }>();
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.set(monthKey(d), { month: monthKey(d), revenue: 0, expenses: 0 });
    }

    const kpi = {
      revenueMonth: 0,
      revenueYear: 0,
      vatMonth: 0,
      unpaidTotal: 0,
      unpaidCount: 0,
      overdueTotal: 0,
      overdueCount: 0,
      draftCount: 0,
      expensesMonth: 0,
      profitMonth: 0,
      dueSoonTotal: 0,
      dueSoonCount: 0,
      unviewedCount: 0,
      missingReceiptsCount: missingReceipts,
    };
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const dueSoonLimit = new Date(today.getFullYear(), today.getMonth(), today.getDate() + DUE_SOON_DAYS + 1);

    let foreignCurrencyCount = 0;
    const enriched: ((typeof invoices)[number]["invoice"] & { contactName: string | null; contactColor: string | null; total: number; isOverdue: boolean })[] = [];
    const dueSoon: typeof enriched = [];
    const customers = new Map<string, { contactId: string; name: string; total: number; count: number }>();

    for (const { invoice, contactName, contactColor } of invoices) {
      const totals = computeVatBreakdown(byInvoice.get(invoice.id) ?? [], { reverseCharge: invoice.reverseCharge });
      const overdue = isOverdue(invoice);
      const row = { ...invoice, contactName, contactColor, total: totals.totalWithVat, isOverdue: overdue };
      enriched.push(row);

      // Waiting on the customer: issued, not paid, not a credit note.
      if (invoice.status === "issued" && invoice.documentType !== "credit_note" && invoice.documentType !== "quote") {
        // Sent but the customer never opened the shared link.
        if (invoice.sentAt && invoice.publicViewCount === 0) kpi.unviewedCount++;
        if (!overdue && invoice.dueDate && invoice.dueDate >= today && invoice.dueDate < dueSoonLimit) {
          dueSoon.push(row);
          kpi.dueSoonCount++;
          if (invoice.currency === "CZK") kpi.dueSoonTotal += totals.totalWithVat;
        }
      }

      if (invoice.status === "draft" || invoice.status === "pending_review") {
        kpi.draftCount++;
        continue;
      }
      // Revenue = tax documents only: invoices and credit notes (negative).
      const isTaxDoc = invoice.documentType === "invoice" || invoice.documentType === "credit_note";
      // Quotes never count; proformas count towards "unpaid" only.
      if (invoice.status === "cancelled" || invoice.documentType === "quote") continue;

      if (invoice.currency !== "CZK") {
        foreignCurrencyCount++;
        continue;
      }

      if (invoice.status === "issued" && invoice.documentType !== "credit_note") {
        kpi.unpaidTotal += totals.totalWithVat;
        kpi.unpaidCount++;
        if (overdue) {
          kpi.overdueTotal += totals.totalWithVat;
          kpi.overdueCount++;
        }
      }

      if (!isTaxDoc) continue;
      const date = invoice.taxableSupplyDate ?? invoice.issueDate ?? invoice.createdAt;
      if (date >= monthStart) {
        kpi.revenueMonth += totals.totalWithoutVat;
        kpi.vatMonth += totals.totalVat;
      }
      if (date >= yearStart) {
        kpi.revenueYear += totals.totalWithoutVat;
        if (invoice.contactId) {
          const c = customers.get(invoice.contactId) ?? {
            contactId: invoice.contactId,
            name: contactName ?? "—",
            total: 0,
            count: 0,
          };
          c.total += totals.totalWithoutVat;
          c.count++;
          customers.set(invoice.contactId, c);
        }
      }
      const bucket = months.get(monthKey(date));
      if (bucket) bucket.revenue += totals.totalWithoutVat;
    }

    for (const e of expenses) {
      if (e.currency !== "CZK") continue;
      // Expense amounts are stored including VAT; the chart compares base amounts.
      const base = Number(e.amount) / (1 + Number(e.vatRate) / 100);
      if (e.expenseDate >= monthStart) kpi.expensesMonth += base;
      const bucket = months.get(monthKey(e.expenseDate));
      if (bucket) bucket.expenses += base;
    }

    kpi.profitMonth = kpi.revenueMonth - kpi.expensesMonth;
    for (const k of Object.keys(kpi) as (keyof typeof kpi)[]) {
      if (!k.endsWith("Count")) kpi[k] = round2(kpi[k]);
    }

    return {
      currency: "CZK",
      kpi,
      foreignCurrencyCount,
      chart: [...months.values()].map((m) => ({
        ...m,
        revenue: round2(m.revenue),
        expenses: round2(m.expenses),
      })),
      recent: enriched.slice(0, 8),
      overdue: enriched.filter((i) => i.isOverdue).slice(0, 8),
      dueSoon: dueSoon.sort((a, b) => a.dueDate!.getTime() - b.dueDate!.getTime()).slice(0, 8),
      topCustomers: [...customers.values()]
        .sort((a, b) => b.total - a.total)
        .slice(0, 5)
        .map((c) => ({ ...c, total: round2(c.total) })),
    };
  }

  /**
   * The period report: totals for [from, to] (whole days, inclusive), the
   * same-length period right before it for comparison, revenue / expenses
   * per day, week or month, the period's top customers and pie-chart
   * shares. Amounts are in CZK (foreign documents at their stored rate), or
   * in the filtered currency when the report is narrowed to one. `db` is
   * the tenant's RLS-scoped connection, so only its own rows ever load.
   */
  async stats(db: Db, from: Date, to: Date, filters: ReportFilters = {}) {
    const end = new Date(to.getFullYear(), to.getMonth(), to.getDate() + 1);
    const start = new Date(from.getFullYear(), from.getMonth(), from.getDate());
    const length = end.getTime() - start.getTime();
    const prevStart = new Date(start.getTime() - length);
    const currency = filters.currency ?? "CZK";

    const rows = await db
      .select({ invoice: schema.invoices, contactName: schema.contacts.legalName })
      .from(schema.invoices)
      .leftJoin(schema.contacts, eq(schema.contacts.id, schema.invoices.contactId))
      .where(inArray(schema.invoices.status, ["issued", "paid"]));
    const ids = rows.map((r) => r.invoice.id);
    const items = ids.length ? await db.select().from(schema.invoiceLineItems).where(inArray(schema.invoiceLineItems.invoiceId, ids)) : [];
    const byInvoice = new Map<string, LineItemRow[]>();
    for (const item of items) byInvoice.set(item.invoiceId, [...(byInvoice.get(item.invoiceId) ?? []), item]);

    const allDocs: StatsDoc[] = rows.map(({ invoice, contactName }) => {
      const totals = computeVatBreakdown(byInvoice.get(invoice.id) ?? [], { reverseCharge: invoice.reverseCharge });
      return {
        documentType: invoice.documentType,
        status: invoice.status,
        currency: invoice.currency,
        language: invoice.language,
        date: invoice.taxableSupplyDate ?? invoice.issueDate ?? invoice.createdAt,
        issueDate: invoice.issueDate,
        dueDate: invoice.dueDate,
        paidAt: invoice.paidAt,
        contactId: invoice.contactId,
        contactName,
        exchangeRate: invoice.exchangeRate == null ? null : Number(invoice.exchangeRate),
        amountPaid: Number(invoice.amountPaid ?? 0),
        base: totals.totalWithoutVat,
        vat: totals.totalVat,
        total: totals.totalWithVat,
      };
    });
    const today = new Date();
    const docs = allDocs.filter((d) => matchesFilters(d, filters, today));
    const expenseRows = await db.select().from(schema.expenses).where(gte(schema.expenses.expenseDate, prevStart));
    // Expense amounts are stored including VAT; revenue is compared without it.
    // Expenses have no customer, type or status, so only the currency filter applies.
    const expenses: StatsExpense[] = expenseRows
      .filter((e) => !filters.currency || e.currency === filters.currency)
      .map((e) => ({
        currency: e.currency,
        date: e.expenseDate,
        base: Number(e.amount) / (1 + Number(e.vatRate) / 100),
        exchangeRate: e.exchangeRate == null ? null : Number(e.exchangeRate),
      }));

    return {
      currency,
      from: start.toISOString(),
      to: new Date(end.getTime() - 1).toISOString(),
      filters,
      /** False when a customer / type / status / language filter is on: expenses then stay unfiltered. */
      expensesFiltered: !hasDocumentFilters(filters),
      options: filterOptions(allDocs),
      current: periodTotals(docs, expenses, start, end, currency, today),
      previous: periodTotals(docs, expenses, prevStart, start, currency, today),
      ...periodBreakdown(docs, expenses, start, end, currency, today),
    };
  }

  /** Months (last three) with EU service sales and purchases from abroad, for the conditional VAT deadlines. */
  async vatActivity(db: Db, tenantId: string, now = new Date()): Promise<VatActivity> {
    const since = new Date(now.getFullYear(), now.getMonth() - 3, 1);
    const [tenant] = await db.select({ country: schema.tenants.addressCountry }).from(schema.tenants).where(eq(schema.tenants.id, tenantId));
    const invoices = await db
      .select({
        documentType: schema.invoices.documentType,
        invoiceNumber: schema.invoices.invoiceNumber,
        status: schema.invoices.status,
        supplyDate: schema.invoices.taxableSupplyDate,
        issueDate: schema.invoices.issueDate,
        ico: schema.contacts.ico,
        dic: schema.contacts.dic,
        isPerson: schema.contacts.isPerson,
        country: schema.contacts.addressCountry,
      })
      .from(schema.invoices)
      .innerJoin(schema.contacts, eq(schema.contacts.id, schema.invoices.contactId))
      .where(gte(schema.invoices.issueDate, since));
    const expenses = await db
      .select({ date: schema.expenses.expenseDate, supplierDic: schema.expenses.supplierDic, supplierCountry: schema.contacts.addressCountry })
      .from(schema.expenses)
      .leftJoin(schema.contacts, eq(schema.contacts.id, schema.expenses.supplierContactId))
      .where(gte(schema.expenses.expenseDate, since));
    return vatActivity(
      tenant?.country ?? "CZ",
      invoices.map((i) => ({
        documentType: i.documentType,
        invoiceNumber: i.invoiceNumber,
        status: i.status,
        date: i.supplyDate ?? i.issueDate,
        customer: { ico: i.ico, dic: i.dic, isPerson: i.isPerson, country: i.country },
      })),
      expenses,
    );
  }

  /**
   * What the company uses (currencies, expenses, bank / PayPal, document
   * types, VAT status…), for the usage-based defaults of the dashboard and
   * the reports page. A handful of GROUP BY / COUNT queries over the
   * tenant's RLS-scoped connection; the logic is in `summarizeUsage`.
   */
  async usage(db: Db, tenantId: string, now = new Date()): Promise<Usage> {
    const since = new Date(now.getFullYear(), now.getMonth() - 12, now.getDate());
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    // Inlined as literals (built from Dates, never user input): with bound
    // parameters Postgres sees the SELECT and GROUP BY expressions as
    // different ($1 vs $2) and refuses the grouping.
    const ts = (d: Date) => sql.raw(`'${d.toISOString()}'::timestamptz`);
    const inv = schema.invoices;
    const invDate = sql`coalesce(${inv.taxableSupplyDate}, ${inv.issueDate}, ${inv.createdAt})`;
    const recentInv = sql<boolean>`(${invDate} >= ${ts(since)})`;
    const overdue = sql<boolean>`(${inv.status} = 'issued' and ${inv.documentType} <> 'quote' and ${inv.dueDate} is not null and ${inv.dueDate} < ${ts(today)})`;
    const recentExp = sql<boolean>`(${schema.expenses.expenseDate} >= ${ts(since)})`;
    const tx = schema.bankTransactions;

    const [invoiceRows, expenseRows, connections, [transactions], [recurring], [templates], [contacts], [tenant]] = await Promise.all([
      db
        .select({
          documentType: inv.documentType,
          status: inv.status,
          currency: inv.currency,
          language: inv.language,
          reverseCharge: inv.reverseCharge,
          recent: recentInv,
          overdue,
          n: count(),
        })
        .from(inv)
        .groupBy(inv.documentType, inv.status, inv.currency, inv.language, inv.reverseCharge, recentInv, overdue),
      db.select({ currency: schema.expenses.currency, recent: recentExp, n: count() }).from(schema.expenses).groupBy(schema.expenses.currency, recentExp),
      db
        .select({ provider: schema.bankConnections.provider, status: schema.bankConnections.status, enabled: schema.bankConnections.enabled })
        .from(schema.bankConnections),
      db
        .select({
          total: count(),
          matched: sql<number>`count(*) filter (where ${tx.matchedInvoiceId} is not null)`.mapWith(Number),
          paypal: sql<number>`count(*) filter (where ${schema.bankStatementImports.source} = 'paypal')`.mapWith(Number),
        })
        .from(tx)
        .leftJoin(schema.bankStatementImports, eq(schema.bankStatementImports.id, tx.importId)),
      db.select({ n: count() }).from(schema.recurringInvoiceTemplates).where(eq(schema.recurringInvoiceTemplates.isActive, true)),
      db.select({ n: count() }).from(schema.invoiceTemplates),
      db.select({ n: count() }).from(schema.contacts),
      db
        .select({ vatStatus: schema.tenants.vatStatus, dicVatPayer: schema.tenants.dicVatPayer, legalName: schema.tenants.legalName })
        .from(schema.tenants)
        .where(eq(schema.tenants.id, tenantId)),
    ]);

    return summarizeUsage({
      invoices: invoiceRows.map((r) => ({ ...r, recent: !!r.recent, overdue: !!r.overdue })),
      expenses: expenseRows.map((r) => ({ ...r, recent: !!r.recent })),
      connections,
      transactions: transactions ?? { total: 0, matched: 0, paypal: 0 },
      recurringCount: recurring?.n ?? 0,
      templateCount: templates?.n ?? 0,
      contactCount: contacts?.n ?? 0,
      tenant: tenant ?? { vatStatus: null, dicVatPayer: false, legalName: null },
    });
  }

  /** The member's own saved keys only (no defaults merged in); older rows stored a bare array of quick-action ids. */
  private async storedConfig(db: Db, tenantId: string, userId: string): Promise<Partial<DashboardConfig>> {
    const [membership] = await db
      .select({ dashboardTiles: schema.tenantMemberships.dashboardTiles })
      .from(schema.tenantMemberships)
      .where(and(eq(schema.tenantMemberships.tenantId, tenantId), eq(schema.tenantMemberships.userId, userId)));
    const stored = membership?.dashboardTiles;
    if (Array.isArray(stored)) return { tiles: stored as string[] };
    if (stored && typeof stored === "object") return stored as Partial<DashboardConfig>;
    return {};
  }

  /**
   * The layout with defaults filled in, plus `savedKeys`: what the member
   * chose themselves. The frontend fills every other key from the
   * company's usage, so a saved choice always wins over a recommendation.
   */
  async getConfig(db: Db, tenantId: string, userId: string): Promise<DashboardConfig & { savedKeys: string[] }> {
    const stored = await this.storedConfig(db, tenantId, userId);
    return { ...DEFAULT_DASHBOARD_CONFIG, ...stored, savedKeys: Object.keys(stored).filter((k) => k in DEFAULT_DASHBOARD_CONFIG) };
  }

  /** Merges into the saved keys; a null value forgets that key, so it follows the defaults (and usage) again. */
  async saveConfig(db: Db, tenantId: string, userId: string, config: { [K in keyof DashboardConfig]?: DashboardConfig[K] | null }) {
    const stored: Record<string, unknown> = { ...(await this.storedConfig(db, tenantId, userId)) };
    for (const [key, value] of Object.entries(config)) {
      if (value === null) delete stored[key];
      else if (value !== undefined) stored[key] = value;
    }
    await db
      .update(schema.tenantMemberships)
      .set({ dashboardTiles: stored })
      .where(and(eq(schema.tenantMemberships.tenantId, tenantId), eq(schema.tenantMemberships.userId, userId)));
    return this.getConfig(db, tenantId, userId);
  }
}
