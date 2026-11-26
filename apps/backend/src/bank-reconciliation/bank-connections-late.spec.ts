import { describe, expect, it, vi } from "vitest";
import { BankConnectionsService } from "./bank-connections.service";

describe("BankConnectionsService late descriptions", () => {
  it("hands a payment it already stored to the late fill, so its draft gets the item names", async () => {
    const reconciliation = {
      fillLateDescriptions: vi.fn(async () => undefined),
      persistAndMatch: vi.fn(async () => ({ summary: { total: 0, matched: 0, unmatched: 0, drafted: 0, ruled: 0, duplicates: 0 } })),
      rematchUnmatched: vi.fn(async () => 0),
      storeOwnMovements: vi.fn(async () => []),
      applyPaypalConversions: vi.fn(async () => 0),
      pairPaypalTransfers: vi.fn(async () => 0),
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

  it("stores PayPal withdrawals and conversions apart from payments and converts with them", async () => {
    const reconciliation = {
      fillLateDescriptions: vi.fn(async () => undefined),
      persistAndMatch: vi.fn(async () => ({ summary: { total: 0, matched: 0, unmatched: 0, drafted: 0, ruled: 0, duplicates: 0 } })),
      rematchUnmatched: vi.fn(async () => 0),
      storeOwnMovements: vi.fn(async () => []),
      applyPaypalConversions: vi.fn(async () => 0),
      pairPaypalTransfers: vi.fn(async () => 0),
    };
    const db = { select: () => ({ from: () => ({ where: async () => [] }) }), update: () => ({ set: () => ({ where: async () => undefined }) }) };
    const day = new Date("2026-11-02");
    const payment = { externalId: "paypal:P1", amount: "45.00", currency: "USD", transactionDate: day };
    const withdrawal = { externalId: "paypal:W1", amount: "-905.13", currency: "CZK", transactionDate: day, withdrawal: true };
    const conversion = { externalId: "paypal:C1", amount: "905.13", currency: "CZK", transactionDate: day, occurredAt: null, conversion: { amount: "42.59", currency: "USD" } };
    const service = new BankConnectionsService(reconciliation as never);
    await (service as unknown as { storeFresh: (...args: unknown[]) => Promise<unknown> }).storeFresh(db, "t1", "PayPal", "paypal", [payment, withdrawal, conversion]);
    expect(reconciliation.persistAndMatch).toHaveBeenCalledWith(db, "t1", "PayPal", "paypal", [payment], expect.anything());
    expect(reconciliation.storeOwnMovements).toHaveBeenCalledWith(db, "t1", expect.any(String), "paypal", [withdrawal, conversion]);
    expect(reconciliation.applyPaypalConversions).toHaveBeenCalledWith(db, "t1", [{ at: day, amount: "905.13", currency: "CZK", from: { amount: "42.59", currency: "USD" } }]);
    expect(reconciliation.pairPaypalTransfers).toHaveBeenCalledWith(db);
  });
});
