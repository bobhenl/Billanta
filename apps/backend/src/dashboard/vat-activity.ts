import { buyerKind } from "@faktur/cz-compliance";

/** Months ("YYYY-MM") with VAT-relevant activity, for the conditional dashboard deadlines (see `applyTaxActivity`). */
export interface VatActivity {
  euSalesMonths: string[];
  foreignPurchaseMonths: string[];
}

export interface ActivityInvoice {
  documentType: string;
  invoiceNumber: string | null;
  status: string;
  date: Date | null;
  customer: { ico: string | null; dic: string | null; isPerson: boolean; country: string } | null;
}

export interface ActivityExpense {
  date: Date | null;
  supplierDic: string | null;
  /** Country of the linked supplier contact, if any. */
  supplierCountry: string | null;
}

const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

/**
 * EU sales: an issued invoice / credit note (not cancelled) to a business in
 * another EU state – the services that go into souhrnné hlášení. Foreign
 * purchases: an expense from a supplier whose DIČ prefix or contact country
 * isn't the company's own – what an identified person pays VAT on.
 */
export function vatActivity(country: string, invoices: ActivityInvoice[], expenses: ActivityExpense[]): VatActivity {
  const own = (country || "CZ").toUpperCase();
  const eu = new Set<string>();
  for (const i of invoices) {
    if (!i.date || !i.customer || !i.invoiceNumber || i.status === "cancelled") continue;
    if (i.documentType !== "invoice" && i.documentType !== "credit_note") continue;
    const c = i.customer;
    const kind = buyerKind(own, { ico: c.ico ?? undefined, dic: c.dic ?? undefined, isPerson: c.isPerson, address: { countryCode: c.country } });
    if (kind === "eu_business") eu.add(monthKey(i.date));
  }
  const foreign = new Set<string>();
  for (const e of expenses) {
    if (!e.date) continue;
    const prefix = /^[A-Z]{2}/i.test(e.supplierDic ?? "") ? e.supplierDic!.slice(0, 2).toUpperCase() : null;
    const abroad = (prefix && prefix !== own) || (e.supplierCountry && e.supplierCountry.toUpperCase() !== own);
    if (abroad) foreign.add(monthKey(e.date));
  }
  return { euSalesMonths: [...eu].sort(), foreignPurchaseMonths: [...foreign].sort() };
}
