import { buildContacts, type DemoContact } from "./contacts";
import { toEnglish } from "./english";
import { buildExpenses, type DemoExpense } from "./expenses";
import { buildInvoices, type DemoInvoice } from "./invoices";
import { SUPPLIERS, type DemoKind, type DemoLanguage, type DemoSupplier } from "./kinds";
import { buildRecurring, type DemoRecurring } from "./recurring";
import { buildTime, type DemoTime } from "./time";

export { buildBankTransactions, type DemoBankTransaction, type SeededInvoice } from "./bank";
export { DEMO_KINDS, isDemoKind, isDemoLanguage, type DemoKind, type DemoLanguage } from "./kinds";
export type { DemoContact, DemoExpense, DemoInvoice, DemoRecurring, DemoSupplier, DemoTime };

export interface DemoDataset {
  kind: DemoKind;
  /** What the visitor reads: the supplier's own language, or English. */
  language: DemoLanguage;
  supplier: DemoSupplier;
  contacts: DemoContact[];
  /** In the order the seeder must process them (a conversion after its source). */
  invoices: DemoInvoice[];
  expenses: DemoExpense[];
  time: DemoTime;
  recurring: DemoRecurring[];
}

/**
 * Everything a fresh demo company holds, relative to `now`. Deterministic:
 * the same kind and day give the same data, which keeps the spec simple and
 * a bug report reproducible. Bank lines are built later from the issued rows.
 * A Czech or Slovak visitor gets the company in its own language; on the
 * English site the same company comes translated.
 */
export function buildDemoDataset(kind: DemoKind, now: Date, language: DemoLanguage = SUPPLIERS[kind].language): DemoDataset {
  const ds: DemoDataset = {
    kind,
    language: SUPPLIERS[kind].language,
    supplier: SUPPLIERS[kind],
    contacts: buildContacts(kind),
    invoices: buildInvoices(kind, now),
    expenses: buildExpenses(kind, now),
    time: buildTime(kind, now),
    recurring: buildRecurring(kind, now),
  };
  return language === "en" ? { ...toEnglish(ds), language: "en" } : ds;
}
