import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ loadPlanSummary: vi.fn(), db: { select: vi.fn() } }));
vi.mock("../billing/plan.guard", () => ({ loadPlanSummary: mocks.loadPlanSummary }));
vi.mock("../db/drizzle-tx", () => ({ drizzleTx: () => mocks.db }));

import { InvoiceRemindersRepository } from "./invoice-reminders.repository";

/** `.select().from().leftJoin().where().limit()`, each resolving to `rows`. */
function chain(rows: unknown[]) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c: any = {};
  for (const m of ["from", "leftJoin", "innerJoin", "where", "orderBy"]) c[m] = vi.fn(() => c);
  c.limit = vi.fn(async () => rows);
  c.then = (resolve: (v: unknown) => unknown) => resolve(rows);
  return c;
}

function repo() {
  const tx = Object.assign(vi.fn(async () => []), {});
  const sql = { begin: async (fn: (t: unknown) => Promise<unknown>) => fn(tx) };
  return new InvoiceRemindersRepository({ sql } as never);
}

beforeEach(() => {
  mocks.db.select.mockReset();
  mocks.db.select.mockReturnValueOnce(chain([{ prefs: { remindersEnabled: true } }])).mockReturnValue(chain([]));
});

describe("InvoiceRemindersRepository – plan", () => {
  it("sends no automatic reminders below Start", async () => {
    mocks.loadPlanSummary.mockResolvedValue({ plan: "free", enforced: true });
    await expect(repo().findOverdueInvoicesForTenant("t1")).resolves.toEqual([]);
    expect(mocks.db.select).toHaveBeenCalledTimes(1); // the invoices were never read
  });

  it("keeps sending them for a company from before plan limits", async () => {
    mocks.loadPlanSummary.mockResolvedValue({ plan: "free", enforced: false });
    await repo().findOverdueInvoicesForTenant("t1");
    expect(mocks.db.select.mock.calls.length).toBeGreaterThan(1);
  });
});
