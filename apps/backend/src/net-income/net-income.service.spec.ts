import { ForbiddenException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";

const guard = vi.hoisted(() => ({ loadPlanSummary: vi.fn() }));
vi.mock("../billing/plan.guard", () => guard);

import { NetIncomeService } from "./net-income.service";
import { DEFAULT_TAX_MODEL } from "./tax-model";

const partner = (i: number) => ({ id: `p${i}`, name: `Partner ${i}`, share: 1, tax_credits: 30_840 });
const withPartners = (n: number) => ({ ...DEFAULT_TAX_MODEL, partners: Array.from({ length: n }, (_, i) => partner(i)) });

/** A tenant whose stored model has `stored` partners. */
function db(stored: number) {
  const where = vi.fn(async () => [{ taxModel: withPartners(stored) }]);
  const update = vi.fn(() => ({ set: () => ({ where: async () => undefined }) }));
  return { select: () => ({ from: () => ({ where }) }), update };
}

async function refusal(promise: Promise<unknown>): Promise<Record<string, unknown>> {
  const err = await promise.then(() => null, (e: unknown) => e);
  expect(err).toBeInstanceOf(ForbiddenException);
  return (err as ForbiddenException).getResponse() as Record<string, unknown>;
}

const save = (fake: ReturnType<typeof db>, n: number) => new NetIncomeService().saveModel(fake as never, "t1", withPartners(n) as never);

beforeEach(() => {
  guard.loadPlanSummary.mockReset();
});

describe("NetIncomeService.saveModel – partner cap", () => {
  it("holds Free to one partner and Start to two, and stores nothing when refused", async () => {
    guard.loadPlanSummary.mockResolvedValue({ plan: "free", enforced: true });
    const fake = db(1);
    expect(await refusal(save(fake, 2))).toMatchObject({ error: "plan_required", message: "partner_limit", limit: 1, plan: "start" });
    expect(fake.update).not.toHaveBeenCalled();

    guard.loadPlanSummary.mockResolvedValue({ plan: "start", enforced: true });
    await save(db(1), 2);
    expect(await refusal(save(db(2), 3))).toMatchObject({ limit: 2, plan: "plus" });
  });

  it("lets a model already over the cap be edited, but not grow", async () => {
    guard.loadPlanSummary.mockResolvedValue({ plan: "free", enforced: true });
    await save(db(3), 3);
    await save(db(3), 2);
    await refusal(save(db(3), 4));
  });

  it("doesn't limit a company from before plan limits", async () => {
    guard.loadPlanSummary.mockResolvedValue({ plan: "free", enforced: false });
    const fake = db(1);
    await save(fake, 5);
    expect(fake.update).toHaveBeenCalled();
  });
});
