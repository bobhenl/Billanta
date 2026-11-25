import { describe, expect, it } from "vitest";
import { DashboardService } from "./dashboard.service";

const DAY = 86_400_000;

/** One invoice with one 1000 CZK line at 21 %, so 1210 with VAT. */
function invoiceRow(id: string, over: Record<string, unknown>) {
  return {
    invoice: {
      id,
      contactId: null,
      invoiceNumber: id,
      documentType: "invoice",
      status: "issued",
      currency: "CZK",
      reverseCharge: false,
      amountPaid: "0",
      dueDate: new Date(Date.now() - 10 * DAY),
      issueDate: new Date(),
      taxableSupplyDate: null,
      createdAt: new Date(),
      sentAt: null,
      publicViewCount: 0,
      ...over,
    },
    contactName: null,
    contactColor: null,
  };
}

const line = (invoiceId: string, quantity = "1") => ({ invoiceId, quantity, unitPrice: "1000", vatRate: "21", discountPercent: null });

/** Each `select()` resolves to the next queued result, in the order the service asks. */
function fakeDb(results: unknown[][]) {
  const queue = [...results];
  return {
    select: () => {
      const rows = queue.shift() ?? [];
      const chain: Record<string, unknown> = {};
      for (const m of ["from", "leftJoin", "where", "orderBy", "limit"]) chain[m] = () => chain;
      chain.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => Promise.resolve(rows).then(resolve, reject);
      return chain;
    },
  };
}

async function summaryOf(invoices: ReturnType<typeof invoiceRow>[], items: ReturnType<typeof line>[]) {
  // tenant country, invoices, line items, the line items' invoice-id subquery, expenses, missing receipts
  const db = fakeDb([[{ country: "CZ" }], invoices, items, [], [], [{ n: 0 }]]);
  return new DashboardService().summary(db as never, "tenant-1");
}

describe("DashboardService.summary unpaid tiles", () => {
  it("counts only what is left after a partial payment", async () => {
    const { kpi } = await summaryOf([invoiceRow("a", { amountPaid: "210" })], [line("a")]);
    expect(kpi.unpaidTotal).toBe(1000);
    expect(kpi.overdueTotal).toBe(1000);
    expect(kpi.unpaidCount).toBe(1);
  });

  it("counts what is left of an invoice due soon", async () => {
    const { kpi } = await summaryOf([invoiceRow("a", { amountPaid: "1000", dueDate: new Date(Date.now() + 2 * DAY) })], [line("a")]);
    expect(kpi.dueSoonTotal).toBe(210);
  });

  it("never lists a credit note as overdue", async () => {
    const summary = await summaryOf([invoiceRow("c", { documentType: "credit_note" })], [line("c", "-1")]);
    expect(summary.kpi.overdueCount).toBe(0);
    expect(summary.overdue).toHaveLength(0);
  });
});
