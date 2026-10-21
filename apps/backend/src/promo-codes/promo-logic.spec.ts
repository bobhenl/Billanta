import { describe, expect, it } from "vitest";
import { normalizePromoCode, promoPatch, promoRejection, type PromoTenantFields, type PromoValidity } from "./promo-logic";

const now = new Date("2026-10-19T10:00:00Z");
const DAY = 86_400_000;

const fresh: PromoTenantFields = {
  trialPlan: null,
  trialStartedAt: null,
  trialEndsAt: null,
  prepaidPlan: null,
  prepaidUntil: null,
  subscriptionPlan: null,
  subscriptionStatus: "inactive",
};

const valid: PromoValidity = { active: true, validFrom: null, validUntil: null, maxRedemptions: null, redemptionCount: 0 };

describe("normalizePromoCode", () => {
  it("upper-cases and trims", () => {
    expect(normalizePromoCode("  startup-week ")).toBe("STARTUP-WEEK");
    expect(normalizePromoCode("ab 12")).toBe("AB12");
  });

  it("rejects what can't be a code", () => {
    expect(normalizePromoCode("ab")).toBeNull();
    expect(normalizePromoCode("-ABC")).toBeNull();
    expect(normalizePromoCode("ABC-")).toBeNull();
    expect(normalizePromoCode("ŽLUŤOUČKÝ")).toBeNull();
    expect(normalizePromoCode("A".repeat(33))).toBeNull();
  });
});

describe("promoRejection", () => {
  it("accepts a live code", () => {
    expect(promoRejection(valid, "2026-10-19")).toBeNull();
    expect(promoRejection({ ...valid, validFrom: "2026-10-19", validUntil: "2026-10-19" }, "2026-10-19")).toBeNull();
  });

  it("hides switched-off and not-yet-started codes behind promo_invalid", () => {
    expect(promoRejection({ ...valid, active: false }, "2026-10-19")).toBe("promo_invalid");
    expect(promoRejection({ ...valid, validFrom: "2026-10-20" }, "2026-10-19")).toBe("promo_invalid");
  });

  it("says when a code ran out", () => {
    expect(promoRejection({ ...valid, validUntil: "2026-10-18" }, "2026-10-19")).toBe("promo_expired");
    expect(promoRejection({ ...valid, maxRedemptions: 50, redemptionCount: 50 }, "2026-10-19")).toBe("promo_used_up");
    expect(promoRejection({ ...valid, maxRedemptions: 50, redemptionCount: 49 }, "2026-10-19")).toBeNull();
  });
});

describe("promoPatch: trial_days", () => {
  it("starts a trial from now", () => {
    const r = promoPatch(fresh, { benefit: "trial_days", plan: "plus", value: 30 }, now);
    expect(r).toEqual({ ok: true, patch: { trialPlan: "plus", trialStartedAt: now, trialEndsAt: new Date(now.getTime() + 30 * DAY), trialRemindedDays: null } });
  });

  it("extends a running trial and keeps its better plan", () => {
    const started = new Date(now.getTime() - 3 * DAY);
    const ends = new Date(now.getTime() + 11 * DAY);
    const r = promoPatch({ ...fresh, trialPlan: "business", trialStartedAt: started, trialEndsAt: ends }, { benefit: "trial_days", plan: "plus", value: 30 }, now);
    expect(r).toEqual({ ok: true, patch: { trialPlan: "business", trialStartedAt: started, trialEndsAt: new Date(ends.getTime() + 30 * DAY), trialRemindedDays: null } });
  });

  it("restarts from now after the trial ended", () => {
    const r = promoPatch({ ...fresh, trialPlan: "business", trialStartedAt: new Date("2026-01-01"), trialEndsAt: new Date("2026-01-15") }, { benefit: "trial_days", plan: "start", value: 7 }, now);
    expect(r.ok && r.patch).toMatchObject({ trialPlan: "start", trialStartedAt: now, trialEndsAt: new Date(now.getTime() + 7 * DAY) });
  });
});

// Every new company starts with the 14-day Plus welcome trial
// (billing/plans.ts TRIAL_PLAN), so a code redeemed at sign-up meets it.
describe("promoPatch on top of the welcome trial", () => {
  const welcome = { ...fresh, trialPlan: "plus", trialStartedAt: now, trialEndsAt: new Date(now.getTime() + 14 * DAY) };

  it("adds trial days after the welcome trial", () => {
    const r = promoPatch(welcome, { benefit: "trial_days", plan: "start", value: 30 }, now);
    expect(r).toEqual({ ok: true, patch: { trialPlan: "plus", trialStartedAt: now, trialEndsAt: new Date(now.getTime() + 44 * DAY), trialRemindedDays: null } });
  });

  it("lets a Business trial code replace the plan for the whole trial", () => {
    const r = promoPatch(welcome, { benefit: "trial_days", plan: "business", value: 30 }, now);
    expect(r.ok && r.patch).toMatchObject({ trialPlan: "business", trialEndsAt: new Date(now.getTime() + 44 * DAY) });
  });

  it("starts free Plus months when the welcome trial ends", () => {
    expect(promoPatch(welcome, { benefit: "free_months", plan: "plus", value: 3 }, now)).toEqual({ ok: true, patch: { prepaidPlan: "plus", prepaidUntil: "2027-02-02" } });
  });

  it("starts free Business months right away", () => {
    expect(promoPatch(welcome, { benefit: "free_months", plan: "business", value: 1 }, now)).toEqual({ ok: true, patch: { prepaidPlan: "business", prepaidUntil: "2026-11-19" } });
  });
});

describe("promoPatch: free_months", () => {
  it("prepays from today", () => {
    expect(promoPatch(fresh, { benefit: "free_months", plan: "plus", value: 3 }, now)).toEqual({ ok: true, patch: { prepaidPlan: "plus", prepaidUntil: "2027-01-19" } });
  });

  it("starts after a running trial of an equal or better plan", () => {
    const t = { ...fresh, trialPlan: "business", trialStartedAt: now, trialEndsAt: new Date("2026-11-02T10:00:00Z") };
    expect(promoPatch(t, { benefit: "free_months", plan: "plus", value: 3 }, now)).toEqual({ ok: true, patch: { prepaidPlan: "plus", prepaidUntil: "2027-02-02" } });
  });

  it("starts today under a trial of a lower plan", () => {
    const t = { ...fresh, trialPlan: "start", trialStartedAt: now, trialEndsAt: new Date("2026-11-02T10:00:00Z") };
    expect(promoPatch(t, { benefit: "free_months", plan: "business", value: 1 }, now)).toEqual({ ok: true, patch: { prepaidPlan: "business", prepaidUntil: "2026-11-19" } });
  });

  it("extends a running prepaid period of the same plan", () => {
    const t = { ...fresh, prepaidPlan: "plus", prepaidUntil: "2026-12-31" };
    expect(promoPatch(t, { benefit: "free_months", plan: "plus", value: 2 }, now)).toEqual({ ok: true, patch: { prepaidPlan: "plus", prepaidUntil: "2027-02-28" } });
  });

  it("refuses next to a prepaid period of another plan", () => {
    const t = { ...fresh, prepaidPlan: "start", prepaidUntil: "2026-12-31" };
    expect(promoPatch(t, { benefit: "free_months", plan: "plus", value: 2 }, now)).toEqual({ ok: false, error: "promo_plan_conflict" });
  });

  it("ignores a prepaid period that is over", () => {
    const t = { ...fresh, prepaidPlan: "start", prepaidUntil: "2026-10-18" };
    expect(promoPatch(t, { benefit: "free_months", plan: "plus", value: 1 }, now)).toEqual({ ok: true, patch: { prepaidPlan: "plus", prepaidUntil: "2026-11-19" } });
  });

  it("refuses next to a live card subscription", () => {
    const t = { ...fresh, subscriptionPlan: "plus", subscriptionStatus: "active" };
    expect(promoPatch(t, { benefit: "free_months", plan: "plus", value: 3 }, now)).toEqual({ ok: false, error: "promo_subscription_active" });
    expect(promoPatch({ ...t, subscriptionStatus: "canceled" }, { benefit: "free_months", plan: "plus", value: 3 }, now).ok).toBe(true);
  });
});
