import { ForbiddenException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";

const limits = vi.hoisted(() => ({ assertPartners: vi.fn() }));
vi.mock("../billing/plan-limits", () => limits);

import { NetIncomeService } from "./net-income.service";
import { DEFAULT_TAX_MODEL } from "./tax-model";

function db() {
  const where = vi.fn(async () => [{ taxModel: DEFAULT_TAX_MODEL }]);
  const update = vi.fn(() => ({ set: () => ({ where: async () => undefined }) }));
  return { select: () => ({ from: () => ({ where }) }), update };
}

const two = {
  ...DEFAULT_TAX_MODEL,
  partners: [
    { id: "me", name: "Já", share: 50, tax_credits: 30_840 },
    { id: "p2", name: "Partner", share: 50, tax_credits: 30_840 },
  ],
};

beforeEach(() => {
  limits.assertPartners.mockReset().mockResolvedValue(undefined);
});

describe("NetIncomeService.saveModel – plan", () => {
  it("checks the new partner count against the stored one", async () => {
    const fake = db();
    await new NetIncomeService().saveModel(fake as never, "t1", two as never);
    expect(limits.assertPartners).toHaveBeenCalledWith(fake, "t1", 2, 1);
    expect(fake.update).toHaveBeenCalled();
  });

  it("stores nothing when the plan refuses", async () => {
    const refusal = new ForbiddenException({ error: "plan_required" });
    limits.assertPartners.mockRejectedValue(refusal);
    const fake = db();
    await expect(new NetIncomeService().saveModel(fake as never, "t1", two as never)).rejects.toBe(refusal);
    expect(fake.update).not.toHaveBeenCalled();
  });
});
