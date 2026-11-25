import { describe, expect, it, vi } from "vitest";
import * as schema from "../../drizzle/schema";
import type { ExpensesService } from "../expenses/expenses.service";
import type { InvoicesService } from "../invoices/invoices.service";
import { BankReconciliationService, type StoredRule } from "./bank-reconciliation.service";
import { compileRule, type RuleConditions } from "./bank-rules";
import { BankRulesService } from "./bank-rules.service";

type StoredRow = typeof schema.bankTransactions.$inferSelect;

function tx(overrides: Partial<StoredRow> & { id: string }): StoredRow {
  return {
    tenantId: "t1",
    importId: "imp",
    transactionDate: new Date("2026-11-20"),
    amount: "-1290.00",
    currency: "CZK",
    variableSymbol: "0001234567",
    counterpartyAccount: "CZ6508000000192000145399",
    counterpartyName: "Vodafone",
    matchedInvoiceId: null,
    status: "unmatched",
    externalId: null,
    fee: null,
    netAmount: null,
    netCurrency: null,
    message: "Telefon 10/2026",
    appliedRuleId: null,
    matchedExpenseId: null,
    createdAt: new Date("2026-11-20"),
    ...overrides,
  };
}

function storedRule(action: StoredRule["action"], conditions: Partial<RuleConditions> = {}, extra: Partial<StoredRule> = {}): StoredRule {
  return {
    id: `rule-${action}`,
    tenantId: "t1",
    name: "Vodafone",
    enabled: true,
    position: 0,
    action,
    conditions: {
      text: [{ field: "counterparty_name", operator: "contains", value: "vodafone" }],
      direction: action === "draft_invoice" ? "in" : action === "draft_expense" ? "out" : "any",
      ...conditions,
    },
    expenseCategory: null,
    contactId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...extra,
  };
}

/** Records every `update(table).set(values).where()` and answers `.returning()` with the row as updated. */
function fakeDb(rows: StoredRow[] = []) {
  const updates: { table: unknown; values: Record<string, unknown> }[] = [];
  const db = {
    update: vi.fn((table: unknown) => ({
      set: (values: Record<string, unknown>) => {
        updates.push({ table, values });
        return { where: () => ({ returning: async () => [{ ...rows[0], ...values }] }) };
      },
    })),
  };
  return { db, updates };
}

function services() {
  const invoicesService = {
    createPaymentDraft: vi.fn(async () => ({ id: "inv-draft" })),
    markPaidFromReconciliation: vi.fn(),
  } as unknown as InvoicesService & { createPaymentDraft: ReturnType<typeof vi.fn> };
  const expensesService = { create: vi.fn(async () => ({ id: "exp-1" })) } as unknown as ExpensesService & {
    create: ReturnType<typeof vi.fn>;
  };
  return { invoicesService, expensesService, service: new BankReconciliationService(invoicesService, expensesService) };
}

describe("BankReconciliationService.applyRuleAction", () => {
  it("ignore: marks the payment ignored and records the rule", async () => {
    const { service, expensesService, invoicesService } = services();
    const row = tx({ id: "tx1" });
    const { db, updates } = fakeDb([row]);
    const updated = await service.applyRuleAction(db as never, "t1", row, storedRule("ignore"));
    expect(updates).toEqual([{ table: schema.bankTransactions, values: { status: "ignored", appliedRuleId: "rule-ignore" } }]);
    expect(updated.status).toBe("ignored");
    expect(expensesService.create).not.toHaveBeenCalled();
    expect(invoicesService.createPaymentDraft).not.toHaveBeenCalled();
  });

  it("draft_expense: an expense flagged for review, linked from the payment", async () => {
    const { service, expensesService } = services();
    const row = tx({ id: "tx1" });
    const { db, updates } = fakeDb([row]);
    await service.applyRuleAction(db as never, "t1", row, storedRule("draft_expense", {}, { expenseCategory: "telecom" }));
    expect(expensesService.create).toHaveBeenCalledWith(
      db,
      "t1",
      expect.objectContaining({ amount: 1290, vatRate: 0, currency: "CZK", category: "telecom", supplierNameRaw: "Vodafone", variableSymbol: "1234567" }),
      { needsReview: true },
    );
    expect(updates).toEqual([
      { table: schema.bankTransactions, values: { matchedExpenseId: "exp-1", status: "matched", appliedRuleId: "rule-draft_expense" } },
    ]);
  });

  it("draft_invoice: a pending_review draft for the chosen contact, linked and tagged with the rule", async () => {
    const { service, invoicesService } = services();
    const row = tx({ id: "tx1", amount: "500.00" });
    const { db, updates } = fakeDb([row]);
    await service.applyRuleAction(db as never, "t1", row, storedRule("draft_invoice", {}, { contactId: "c-1" }));
    expect(invoicesService.createPaymentDraft).toHaveBeenCalledWith(db, "t1", expect.objectContaining({ amount: 500, contactId: "c-1" }));
    expect(updates).toEqual([
      { table: schema.bankTransactions, values: { matchedInvoiceId: "inv-draft", status: "matched", appliedRuleId: "rule-draft_invoice" } },
    ]);
  });
});

describe("BankReconciliationService.persistAndMatch with rules", () => {
  /** An import of `rows`; `matchedIds` are settled by auto-match, the rest stay unmatched. */
  async function runImport(rows: StoredRow[], matchedIds: string[], rules: StoredRule[], options: { ruleDrafts?: boolean } = {}) {
    const { service } = services();
    const db = {
      insert: vi.fn((table: unknown) => ({
        values: () => ({
          returning: async () => [{ id: "imp" }],
          onConflictDoNothing: () => ({ returning: async () => (table === schema.bankTransactions ? rows : []) }),
        }),
      })),
    };
    const internals = service as unknown as Record<string, unknown>;
    vi.spyOn(internals as never, "storedAround" as never).mockResolvedValue([] as never);
    vi.spyOn(internals as never, "loadPools" as never).mockResolvedValue({ issued: [], paid: [] } as never);
    vi.spyOn(internals as never, "applyMatch" as never).mockImplementation((async (_db: unknown, _t: string, row: StoredRow) =>
      matchedIds.includes(row.id)
        ? { type: "matched", invoiceId: "inv", updated: { ...row, status: "matched" } }
        : { type: "unmatched", reason: "no_candidate" }) as never);
    vi.spyOn(service, "loadCompiledRules").mockResolvedValue(rules.map((r) => compileRule(r)));
    const applied = vi.spyOn(service, "applyRuleAction").mockImplementation(async (_db, _t, row, rule) => ({ ...row, status: "ignored", appliedRuleId: rule.id }));
    const incoming = rows.map((r) => ({
      transactionDate: r.transactionDate,
      amount: r.amount,
      currency: r.currency,
      variableSymbol: r.variableSymbol,
      counterpartyAccount: r.counterpartyAccount,
      counterpartyName: r.counterpartyName,
      message: r.message,
    }));
    const result = await service.persistAndMatch(db as never, "t1", "x.csv", "csv", incoming as never, options);
    return { result, applied };
  }

  it("a payment an invoice matched is never handed to a rule", async () => {
    const rows = [tx({ id: "paid" }), tx({ id: "open" })];
    const { result, applied } = await runImport(rows, ["paid"], [storedRule("ignore")]);
    expect(applied.mock.calls.map((c) => c[2].id)).toEqual(["open"]);
    expect(result.summary).toMatchObject({ total: 2, matched: 1, ruled: 1, unmatched: 0 });
  });

  it("payments no rule fits stay unmatched", async () => {
    const rows = [tx({ id: "open", counterpartyName: "O2" })];
    const { result, applied } = await runImport(rows, [], [storedRule("ignore")]);
    expect(applied).not.toHaveBeenCalled();
    expect(result.summary).toMatchObject({ ruled: 0, unmatched: 1 });
  });

  it("a backfill lets ignore rules act but not draft rules", async () => {
    const rows = [tx({ id: "open" })];
    const drafts = await runImport(rows, [], [storedRule("draft_expense")], { ruleDrafts: false });
    expect(drafts.applied).not.toHaveBeenCalled();
    const ignore = await runImport(rows, [], [storedRule("ignore")], { ruleDrafts: false });
    expect(ignore.applied).toHaveBeenCalledTimes(1);
  });
});

describe("BankRulesService.apply", () => {
  it("runs auto-match first, then acts only on payments still unmatched", async () => {
    const order: string[] = [];
    const rows = [tx({ id: "open" }), tx({ id: "done", status: "matched" }), tx({ id: "other", counterpartyName: "O2" })];
    const rule = storedRule("ignore");
    const db = {
      select: () => ({
        from: (table: unknown) => ({
          where: () =>
            table === schema.bankRules
              ? { limit: async () => [rule] }
              : { orderBy: async () => (order.push("load"), rows) },
        }),
      }),
    };
    const reconciliation = {
      rematchUnmatched: vi.fn(async () => (order.push("rematch"), { checked: 3, matched: 0, linked: 0 })),
      applyRuleAction: vi.fn(async (_db: unknown, _t: string, row: StoredRow) => row),
    };
    const service = new BankRulesService(reconciliation as unknown as BankReconciliationService);
    const result = await service.apply(db as never, "t1", rule.id);
    expect(order).toEqual(["rematch", "load"]);
    expect(reconciliation.applyRuleAction.mock.calls.map((c) => c[2].id)).toEqual(["open"]);
    expect(result).toEqual({ applied: 1, remaining: 0, rematched: 0 });
  });
});
