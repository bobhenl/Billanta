import { buildContacts, type DemoContact } from "./contacts";
import { buildExpenses, type DemoExpense } from "./expenses";
import { buildInvoices, type DemoInvoice } from "./invoices";
import { SUPPLIERS, type DemoKind, type DemoSupplier } from "./kinds";
import { buildRecurring, type DemoRecurring } from "./recurring";
import { buildTime, type DemoTime } from "./time";

export { buildBankTransactions, type DemoBankTransaction, type SeededInvoice } from "./bank";
export { DEMO_KINDS, isDemoKind, type DemoKind } from "./kinds";
export type { DemoContact, DemoExpense, DemoInvoice, DemoRecurring, DemoSupplier, DemoTime };

export interface DemoDataset {
  kind: DemoKind;
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
 */
export function buildDemoDataset(kind: DemoKind, now: Date): DemoDataset {
  return {
    kind,
    supplier: SUPPLIERS[kind],
    contacts: buildContacts(kind),
    invoices: buildInvoices(kind, now),
    expenses: buildExpenses(kind, now),
    time: buildTime(kind, now),
    recurring: buildRecurring(kind, now),
  };
}
