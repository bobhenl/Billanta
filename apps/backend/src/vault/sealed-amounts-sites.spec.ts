import { describe, expect, it, vi } from "vitest";
import { ExportsService } from "../exports/exports.service";
import { RecurringInvoiceGenerationService } from "../recurring-invoices/recurring-invoice-generation.service";

// The places that use the sealed-amounts guards, beyond the guards themselves (sealed-amounts.spec.ts).

const env = `enc:v1:AAAAAAAAAAAAAAAA:${"Q".repeat(24)}`;

describe("accountant export over sealed amounts", () => {
  it("refuses the whole file and names the sealed documents", async () => {
    const invoice = (id: string, encAmounts: string | null) => ({
      id,
      encAmounts,
      documentType: "invoice",
      status: "issued",
      issueDate: new Date("2026-03-01"),
      dueDate: new Date("2026-03-15"),
      currency: "CZK",
      amountPaid: "0",
      contactId: "c1",
    });
    const rows = [
      { invoice: invoice("plain", null), contact: null },
      { invoice: invoice("sealed", env), contact: null },
    ];
    const chain: Record<string, unknown> = {};
    for (const m of ["select", "from", "leftJoin", "where"]) chain[m] = () => chain;
    chain.orderBy = vi.fn(async () => rows);
    const load = (new ExportsService() as unknown as { loadInvoices: (db: unknown, p: unknown) => Promise<unknown> }).loadInvoices;
    await expect(
      load.call(new ExportsService(), chain, { from: new Date("2026-01-01"), to: new Date("2027-01-01") }),
    ).rejects.toMatchObject({ status: 409, response: { message: "amounts_sealed", sealed: { count: 1, ids: ["sealed"] } } });
  });
});

describe("recurring generation over sealed amounts", () => {
  it("gives the draft the template's totals envelope as it is", async () => {
    const inserted: Record<string, unknown>[] = [];
    const db = {
      select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ contactPerson: null }] }) }) }),
      insert: () => ({
        values: (v: Record<string, unknown>) => {
          inserted.push(v);
          return { returning: async () => [{ id: "inv-new" }] };
        },
      }),
      update: () => ({ set: () => ({ where: async () => [] }) }),
    };
    const service = new RecurringInvoiceGenerationService({} as never) as unknown as {
      materialize: (db: unknown, tenantId: string, template: unknown) => Promise<void>;
    };
    await service.materialize(db, "t1", {
      id: "tpl",
      contactId: "c1",
      currency: "CZK",
      encAmounts: env,
      lineItemsSnapshot: [],
      nextRunDate: new Date("2026-12-01"),
      frequency: "monthly",
      intervalCount: 1,
    });
    expect(inserted[0]).toMatchObject({ encAmounts: env, status: "draft" });
  });
});
