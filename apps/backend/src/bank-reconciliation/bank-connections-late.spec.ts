import { describe, expect, it, vi } from "vitest";
import { BankConnectionsService } from "./bank-connections.service";

describe("BankConnectionsService late descriptions", () => {
  it("hands a payment it already stored to the late fill, so its draft gets the item names", async () => {
    const reconciliation = {
      fillLateDescriptions: vi.fn(async () => undefined),
      persistAndMatch: vi.fn(async () => ({ summary: { total: 0, matched: 0, unmatched: 0, drafted: 0, ruled: 0, duplicates: 0 } })),
      rematchUnmatched: vi.fn(async () => 0),
    };
    const db = {
      select: () => ({ from: () => ({ where: async () => [{ id: "tx-1", externalId: "paypal:45E2", netAmount: null }] }) }),
      update: () => ({ set: () => ({ where: async () => undefined }) }),
    };
    const known = { externalId: "paypal:45E2", message: "Tebex Webstore - Rank category overhaul", amount: "25.00", currency: "USD", transactionDate: new Date("2026-08-24") };
    const fresh = { externalId: "paypal:NEW1", message: "Other", amount: "5.00", currency: "USD", transactionDate: new Date("2026-11-25") };
    const service = new BankConnectionsService(reconciliation as never);
    await (service as unknown as { storeFresh: (...args: unknown[]) => Promise<unknown> }).storeFresh(db, "t1", "PayPal", "paypal", [known, fresh]);
    expect(reconciliation.fillLateDescriptions).toHaveBeenCalledWith(db, [known], []);
    expect(reconciliation.persistAndMatch).toHaveBeenCalledWith(db, "t1", "PayPal", "paypal", [fresh], expect.anything());
  });
});
