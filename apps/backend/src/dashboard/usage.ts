import { isLegalEntityName, isVatStatus, type VatStatus } from "@faktur/cz-compliance";

/**
 * What the company actually uses, so the dashboard and the reports page can
 * pick sensible defaults (ČNB rates only for currencies it invoices in, no
 * expense cards when it never records expenses, no VAT for a non-payer…).
 * The service feeds this already-grouped rows (one SQL GROUP BY per table),
 * so the endpoint stays cheap however many documents there are.
 */

/** One GROUP BY row over invoices. `recent` = dated in the last 12 months. */
export interface InvoiceUsageRow {
  documentType: string;
  status: string;
  currency: string;
  language: string;
  reverseCharge: boolean;
  recent: boolean;
  /** Issued, not a quote, due before today (same rule as `isOverdue`). */
  overdue: boolean;
  n: number;
}

export interface ExpenseUsageRow {
  currency: string;
  recent: boolean;
  n: number;
}

export interface ConnectionUsageRow {
  provider: string;
  status: string;
  enabled: boolean;
}

export interface UsageInput {
  homeCurrency?: string;
  invoices: InvoiceUsageRow[];
  expenses: ExpenseUsageRow[];
  connections: ConnectionUsageRow[];
  /** Bank / PayPal statement lines, and how many of them were paired with an invoice. */
  transactions: { total: number; matched: number; paypal: number };
  recurringCount: number;
  templateCount: number;
  contactCount: number;
  tenant: { vatStatus: string | null; dicVatPayer: boolean | null; legalName: string | null };
}

export interface CurrencyUsage {
  code: string;
  invoices: number;
  invoices12m: number;
  expenses: number;
  expenses12m: number;
}

export interface Usage {
  homeCurrency: string;
  /** Every currency on an issued document or an expense, most used first. */
  currencies: CurrencyUsage[];
  /** Foreign currencies used in the last 12 months; all-time ones when none were used lately. */
  foreignCurrencies: string[];
  /** Languages of issued documents, most used first. */
  languages: string[];
  documents: { invoices: number; proformas: number; quotes: number; creditNotes: number; drafts: number; reverseCharge: number };
  expenses: { count: number; count12m: number };
  bank: { connections: number; activeConnections: number; bankApi: boolean; paypal: boolean; transactions: number; matched: number };
  recurringCount: number;
  templateCount: number;
  contactCount: number;
  unpaidCount: number;
  overdueCount: number;
  vatStatus: VatStatus;
  accountType: "company" | "self_employed";
  /** Shortcuts for the frontend's defaults. */
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
    /** VAT figures make sense: a payer, or an identified person with reverse-charge documents. */
    vat: boolean;
  };
}

/** Drafts are not "used" yet: they never left the company. Cancelled ones did. */
const issued = (status: string) => status !== "draft" && status !== "pending_review";

export function summarizeUsage(input: UsageInput): Usage {
  const home = (input.homeCurrency ?? "CZK").toUpperCase();
  const currencies = new Map<string, CurrencyUsage>();
  const cur = (code: string) => {
    const key = code.toUpperCase();
    let c = currencies.get(key);
    if (!c) currencies.set(key, (c = { code: key, invoices: 0, invoices12m: 0, expenses: 0, expenses12m: 0 }));
    return c;
  };
  const languages = new Map<string, number>();
  const documents = { invoices: 0, proformas: 0, quotes: 0, creditNotes: 0, drafts: 0, reverseCharge: 0 };
  let unpaidCount = 0;
  let overdueCount = 0;

  for (const row of input.invoices) {
    if (!issued(row.status)) {
      documents.drafts += row.n;
      continue;
    }
    const c = cur(row.currency);
    c.invoices += row.n;
    if (row.recent) c.invoices12m += row.n;
    languages.set(row.language, (languages.get(row.language) ?? 0) + row.n);
    if (row.documentType === "invoice") documents.invoices += row.n;
    else if (row.documentType === "proforma") documents.proformas += row.n;
    else if (row.documentType === "quote") documents.quotes += row.n;
    else if (row.documentType === "credit_note") documents.creditNotes += row.n;
    if (row.reverseCharge && row.status !== "cancelled") documents.reverseCharge += row.n;
    // Waiting on the customer: same rule as the dashboard's "unpaid" card.
    if (row.status === "issued" && row.documentType !== "quote" && row.documentType !== "credit_note") {
      unpaidCount += row.n;
      if (row.overdue) overdueCount += row.n;
    }
  }

  let expenseCount = 0;
  let expenseCount12m = 0;
  for (const row of input.expenses) {
    const c = cur(row.currency);
    c.expenses += row.n;
    expenseCount += row.n;
    if (row.recent) {
      c.expenses12m += row.n;
      expenseCount12m += row.n;
    }
  }

  const sorted = [...currencies.values()].sort((a, b) => b.invoices + b.expenses - (a.invoices + a.expenses) || a.code.localeCompare(b.code));
  const foreign = sorted.filter((c) => c.code !== home);
  const recentForeign = foreign.filter((c) => c.invoices12m + c.expenses12m > 0).map((c) => c.code);

  const connections = input.connections;
  const live = connections.filter((c) => c.enabled && c.status === "active");
  const paypal = connections.some((c) => c.provider === "paypal") || input.transactions.paypal > 0;
  const bankApi = connections.some((c) => c.provider !== "paypal");

  const vatStatus: VatStatus = isVatStatus(input.tenant.vatStatus) ? input.tenant.vatStatus : input.tenant.dicVatPayer ? "payer" : "non_payer";
  const vat = vatStatus === "payer" || (vatStatus === "identified" && documents.reverseCharge > 0);
  const languageList = [...languages].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([l]) => l);

  return {
    homeCurrency: home,
    currencies: sorted,
    foreignCurrencies: recentForeign.length > 0 ? recentForeign : foreign.map((c) => c.code),
    languages: languageList,
    documents,
    expenses: { count: expenseCount, count12m: expenseCount12m },
    bank: {
      connections: connections.length,
      activeConnections: live.length,
      bankApi,
      paypal,
      transactions: input.transactions.total,
      matched: input.transactions.matched,
    },
    recurringCount: input.recurringCount,
    templateCount: input.templateCount,
    contactCount: input.contactCount,
    unpaidCount,
    overdueCount,
    vatStatus,
    accountType: isLegalEntityName(input.tenant.legalName) ? "company" : "self_employed",
    has: {
      invoices: documents.invoices + documents.proformas + documents.quotes + documents.creditNotes > 0,
      expenses: expenseCount > 0,
      foreignCurrencies: foreign.length > 0,
      multipleLanguages: languageList.length > 1,
      bank: connections.length > 0 || input.transactions.total > 0,
      paypal,
      proformas: documents.proformas > 0,
      quotes: documents.quotes > 0,
      creditNotes: documents.creditNotes > 0,
      recurring: input.recurringCount > 0,
      templates: input.templateCount > 0,
      vat,
    },
  };
}
