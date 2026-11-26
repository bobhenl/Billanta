import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { describe, expect, it, vi } from "vitest";
import * as schema from "../../drizzle/schema";
import type { ExpensesService } from "../expenses/expenses.service";
import type { InvoicesService } from "../invoices/invoices.service";
import { BankReconciliationService } from "./bank-reconciliation.service";

/** Answers each `select()` chain with the next queued result and records every `update().set()`. */
function fakeDb(selects: unknown[][], returning: Record<string, unknown>) {
  const updates: { table: unknown; values: Record<string, unknown> }[] = [];
  const chain = (result: unknown[]) => {
    const c: Record<string, unknown> = {};
    for (const m of ["from", "where", "limit"]) c[m] = () => c;
    c.then = (ok: (v: unknown) => unknown, err: (e: unknown) => unknown) => Promise.resolve(result).then(ok, err);
    return c;
  };
  const db = {
    select: vi.fn(() => chain(selects.shift() ?? [])),
    update: vi.fn((table: unknown) => ({
      set: (values: Record<string, unknown>) => {
        updates.push({ table, values });
        return { where: () => Object.assign(Promise.resolve([]), { returning: async () => [returning] }) };
      },
    })),
  };
  return { db: db as unknown as PostgresJsDatabase<typeof schema>, updates };
}

describe("BankReconciliationService.applyPaypalConversions", () => {
  it("stores the day PayPal converted a held payment next to its home value", async () => {
    const service = new BankReconciliationService({} as InvoicesService, {} as ExpensesService);
    const at = new Date("2026-11-02T08:00:00Z");
    const { db, updates } = fakeDb(
      [
        [{ country: "CZ" }],
        [{ id: "tx1", at: new Date("2026-10-20T10:00:00Z"), amount: "45.00", currency: "USD", fee: "2.41" }],
        [{ currency: "USD", internalNote: null }],
        [{ amount: "45.00", currency: "USD", netAmount: "905.13", netCurrency: "CZK" }],
      ],
      { invoiceId: "inv1", amount: "45.00", currency: "USD", fee: "2.41" },
    );
    await service.applyPaypalConversions(db, "t1", [{ at, amount: "905.13", currency: "CZK", from: { amount: "42.59", currency: "USD" } }]);
    const tx = updates.find((u) => u.table === schema.bankTransactions);
    expect(tx?.values).toMatchObject({ netAmount: "905.13", netCurrency: "CZK", netAt: at });
    const invoice = updates.find((u) => u.table === schema.invoices);
    expect(invoice?.values).toMatchObject({ receivedCzk: "905.13" });
  });
});
