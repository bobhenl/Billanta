import { ForbiddenException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loadPlanSummary: vi.fn(),
  consumeUsage: vi.fn(),
  readUsage: vi.fn(async (_db: unknown, _t: string, _metrics: string[], _period: string) => [] as { metric: string; count: number }[]),
}));
vi.mock("./plan.guard", () => ({ loadPlanSummary: mocks.loadPlanSummary }));
vi.mock("./usage.repository", () => ({ consumeUsage: mocks.consumeUsage, readUsage: mocks.readUsage }));

import { assertPartners, assertPlanFeature, countIssuedDocument, spendFeature, usageOverview } from "./plan-limits";

const db = {} as never;
const now = new Date("2026-03-10T12:00:00Z");
const plan = (p: string, enforced = true) => ({ plan: p, enforced });

async function refusal(promise: Promise<unknown>): Promise<Record<string, unknown>> {
  const err = await promise.then(() => null, (e: unknown) => e);
  expect(err).toBeInstanceOf(ForbiddenException);
  return (err as ForbiddenException).getResponse() as Record<string, unknown>;
}

beforeEach(() => {
  mocks.loadPlanSummary.mockReset();
  mocks.consumeUsage.mockReset();
  mocks.readUsage.mockReset().mockResolvedValue([]);
});

describe("countIssuedDocument", () => {
  it("holds Free to 10 a month and says which plan lifts it", async () => {
    mocks.loadPlanSummary.mockResolvedValue(plan("free"));
    mocks.consumeUsage.mockResolvedValue({ ok: false, count: 10 });
    const body = await refusal(countIssuedDocument(db, "t1", now));
    expect(mocks.consumeUsage).toHaveBeenCalledWith(db, "t1", "documents", "2026-03", 10);
    expect(body).toMatchObject({ error: "plan_required", feature: "documents", plan: "start", limit: 10 });
  });

  it("still counts a paid or older company, without a limit", async () => {
    mocks.loadPlanSummary.mockResolvedValue(plan("free", false));
    mocks.consumeUsage.mockResolvedValue({ ok: true, count: 40 });
    await countIssuedDocument(db, "t1", now);
    expect(mocks.consumeUsage).toHaveBeenCalledWith(db, "t1", "documents", "2026-03", null);
  });
});

describe("spendFeature", () => {
  it("uses nothing on the feature's own plan", async () => {
    mocks.loadPlanSummary.mockResolvedValue(plan("plus"));
    await expect(spendFeature(db, "t1", "vat_filings", now)).resolves.toBe("plan");
    expect(mocks.consumeUsage).not.toHaveBeenCalled();
  });

  it("spends the one lifetime VAT download below Plus", async () => {
    mocks.loadPlanSummary.mockResolvedValue(plan("start"));
    mocks.consumeUsage.mockResolvedValue({ ok: true, count: 1 });
    await expect(spendFeature(db, "t1", "vat_filings", now)).resolves.toBe("taste");
    expect(mocks.consumeUsage).toHaveBeenCalledWith(db, "t1", "taste_vat_filings", "all", 1);
  });

  it("refuses once the taste is used, saying what the plan gives", async () => {
    mocks.loadPlanSummary.mockResolvedValue(plan("free"));
    mocks.consumeUsage.mockResolvedValue({ ok: false, count: 1 });
    const body = await refusal(spendFeature(db, "t1", "accounting_export", now));
    expect(mocks.consumeUsage).toHaveBeenCalledWith(db, "t1", "taste_accounting_export", "2026-03", 1);
    expect(body).toMatchObject({ error: "plan_required", feature: "accounting_export", plan: "start", taste: { uses: 1, per: "month" } });
  });

  it("refuses a feature without a taste outright", async () => {
    mocks.loadPlanSummary.mockResolvedValue(plan("free"));
    const body = await refusal(spendFeature(db, "t1", "income_tax_export", now));
    expect(mocks.consumeUsage).not.toHaveBeenCalled();
    expect(body).toMatchObject({ feature: "income_tax_export", plan: "start" });
  });
});

describe("assertPlanFeature", () => {
  it("lets an older company through and stops an enforced Free one", async () => {
    mocks.loadPlanSummary.mockResolvedValue(plan("free", false));
    await expect(assertPlanFeature(db, "t1", "webhooks")).resolves.toBeUndefined();
    mocks.loadPlanSummary.mockResolvedValue(plan("free"));
    expect(await refusal(assertPlanFeature(db, "t1", "webhooks"))).toMatchObject({ feature: "webhooks", plan: "start" });
  });
});

describe("usageOverview", () => {
  it("reports this month's counters against the plan and the tastes left", async () => {
    mocks.loadPlanSummary.mockResolvedValue(plan("free"));
    mocks.readUsage.mockImplementation(async (_db: unknown, _t: string, metrics: string[], period: string) =>
      period === "all"
        ? [{ metric: "taste_vat_filings", count: 1 }]
        : [
            { metric: "documents", count: 7 },
            { metric: "ai_credits", count: 2 },
          ].filter((r) => metrics.includes(r.metric)),
    );
    const o = await usageOverview(db, "t1", now);
    expect(o.documents).toEqual({ used: 7, limit: 10, remaining: 3 });
    expect(o.aiCredits).toEqual({ used: 2, limit: 5, remaining: 3 });
    expect(o.features.accounting_export).toEqual({ access: "taste", plan: "start", tasteLeft: 1 });
    expect(o.features.vat_filings).toEqual({ access: "locked", plan: "plus", tasteLeft: 0 });
    expect(o.features.webhooks).toEqual({ access: "locked", plan: "start", tasteLeft: null });
    expect(o.partnersLimit).toBe(1);
  });
});

describe("assertPartners", () => {
  it("holds Free to one partner and Start to two", async () => {
    mocks.loadPlanSummary.mockResolvedValue(plan("free"));
    expect(await refusal(assertPartners(db, "t1", 2, 1))).toMatchObject({ error: "plan_required", feature: "partners", plan: "start", limit: 1 });
    mocks.loadPlanSummary.mockResolvedValue(plan("start"));
    await assertPartners(db, "t1", 2, 1);
    expect(await refusal(assertPartners(db, "t1", 3, 2))).toMatchObject({ plan: "plus", limit: 2 });
  });

  it("lets a model that already has more partners be edited, but not grow", async () => {
    mocks.loadPlanSummary.mockResolvedValue(plan("free"));
    await assertPartners(db, "t1", 3, 3);
    await assertPartners(db, "t1", 2, 3);
    await refusal(assertPartners(db, "t1", 4, 3));
  });

  it("doesn't limit a company from before plan limits", async () => {
    mocks.loadPlanSummary.mockResolvedValue(plan("free", false));
    await assertPartners(db, "t1", 5, 1);
  });
});
