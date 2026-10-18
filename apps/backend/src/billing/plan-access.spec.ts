import { describe, expect, it } from "vitest";
import { daysLeft, planAllows, planSummary, prepaidReminderDue, trialReminderDue, type TenantPlanFields } from "./plan-access";
import { periodPriceMinor } from "./plans";

const NOW = new Date("2026-10-17T09:00:00Z");
const hours = (h: number) => new Date(NOW.getTime() + h * 3_600_000);

const base: TenantPlanFields = {
  planEnforced: true,
  trialPlan: null,
  trialStartedAt: null,
  trialEndsAt: null,
  prepaidPlan: null,
  prepaidUntil: null,
  subscriptionPlan: null,
  subscriptionStatus: "trialing",
};

describe("daysLeft", () => {
  it("rounds up partial days and stops at zero", () => {
    expect(daysLeft(hours(1), NOW)).toBe(1);
    expect(daysLeft(hours(24), NOW)).toBe(1);
    expect(daysLeft(hours(25), NOW)).toBe(2);
    expect(daysLeft(hours(-5), NOW)).toBe(0);
  });
});

describe("planSummary", () => {
  it("is free without a trial or payment", () => {
    expect(planSummary(base, NOW)).toMatchObject({ plan: "free", source: "free", trial: null });
  });

  it("gives the trial plan while the trial runs and free once it ended", () => {
    const running = planSummary({ ...base, trialPlan: "business", trialEndsAt: hours(24 * 13 + 2) }, NOW);
    expect(running).toMatchObject({ plan: "business", source: "trial", trial: { daysLeft: 14, active: true } });

    const ended = planSummary({ ...base, trialPlan: "business", trialEndsAt: hours(-1) }, NOW);
    expect(ended).toMatchObject({ plan: "free", source: "free", trial: { daysLeft: 0, active: false } });
  });

  it("takes the higher of trial and a paid plan", () => {
    const t = { ...base, trialPlan: "business", trialEndsAt: hours(48) };
    expect(planSummary({ ...t, subscriptionPlan: "start", subscriptionStatus: "active" }, NOW)).toMatchObject({ plan: "business", source: "trial" });
    // After the trial the subscription carries on.
    expect(planSummary({ ...t, trialEndsAt: hours(-1), subscriptionPlan: "start", subscriptionStatus: "active" }, NOW)).toMatchObject({
      plan: "start",
      source: "subscription",
    });
  });

  it("keeps the subscription plan while past_due, drops it once canceled", () => {
    expect(planSummary({ ...base, subscriptionPlan: "plus", subscriptionStatus: "past_due" }, NOW).plan).toBe("plus");
    expect(planSummary({ ...base, subscriptionPlan: "plus", subscriptionStatus: "canceled" }, NOW).plan).toBe("free");
    // trialing is the column's default for every company, not a Stripe state we trust for a plan.
    expect(planSummary({ ...base, subscriptionPlan: "plus", subscriptionStatus: "trialing" }, NOW).plan).toBe("free");
  });

  it("counts a prepaid plan through its last day", () => {
    expect(planSummary({ ...base, prepaidPlan: "plus", prepaidUntil: "2026-10-17" }, NOW)).toMatchObject({ plan: "plus", source: "prepaid" });
    expect(planSummary({ ...base, prepaidPlan: "plus", prepaidUntil: "2026-10-16" }, NOW).plan).toBe("free");
  });

  it("ignores unknown plan keys", () => {
    expect(planSummary({ ...base, prepaidPlan: "gold", prepaidUntil: "2099-01-01", trialPlan: "x", trialEndsAt: hours(48) }, NOW).plan).toBe("free");
  });
});

describe("planAllows", () => {
  it("restricts only enforced companies", () => {
    expect(planAllows({ plan: "free", enforced: true }, "bank_sync")).toBe(false);
    expect(planAllows({ plan: "free", enforced: false }, "bank_sync")).toBe(true);
    expect(planAllows({ plan: "start", enforced: true }, "bank_sync")).toBe(true);
    expect(planAllows({ plan: "start", enforced: true }, "card_payments")).toBe(false);
    expect(planAllows({ plan: "plus", enforced: true }, "card_payments")).toBe(true);
  });
});

describe("trialReminderDue", () => {
  const trial = (h: number) => planSummary({ ...base, trialPlan: "business", trialEndsAt: hours(h) }, NOW);

  it("sends 3, then 1, then the ended notice, each once", () => {
    expect(trialReminderDue(trial(24 * 5), null, NOW)).toBeNull();
    expect(trialReminderDue(trial(24 * 3), null, NOW)).toBe(3);
    expect(trialReminderDue(trial(24 * 3), 3, NOW)).toBeNull();
    expect(trialReminderDue(trial(24 * 2), 3, NOW)).toBeNull();
    expect(trialReminderDue(trial(20), 3, NOW)).toBe(1);
    expect(trialReminderDue(trial(20), 1, NOW)).toBeNull();
    expect(trialReminderDue(trial(-2), 1, NOW)).toBe(0);
    expect(trialReminderDue(trial(-2), 0, NOW)).toBeNull();
  });

  it("skips straight to the latest stage when the job missed earlier ones", () => {
    expect(trialReminderDue(trial(10), null, NOW)).toBe(1);
  });

  it("says nothing to a paying company or about a trial long over", () => {
    const paying = planSummary({ ...base, trialPlan: "business", trialEndsAt: hours(20), prepaidPlan: "start", prepaidUntil: "2027-01-01" }, NOW);
    expect(trialReminderDue(paying, null, NOW)).toBeNull();
    expect(trialReminderDue(trial(-24 * 5), null, NOW)).toBeNull();
  });
});

describe("periodPriceMinor", () => {
  it("charges twelve months at the yearly rate", () => {
    expect(periodPriceMinor("business", "CZK", "year")).toBe(479 * 12 * 100);
    expect(periodPriceMinor("start", "EUR", "month")).toBe(599);
  });
});

describe("prepaidReminderDue", () => {
  const none = { until: null, days: null };
  const period = (prepaidUntil: string | null, subscriptionLive = false) => ({ prepaidUntil, subscriptionLive });

  it("is quiet more than 14 days out, then sends 14 and 3", () => {
    expect(prepaidReminderDue(period("2026-11-01"), none, "2026-10-17")).toBeNull(); // 15 days
    expect(prepaidReminderDue(period("2026-11-01"), none, "2026-10-18")).toBe(14);
    expect(prepaidReminderDue(period("2026-11-01"), { until: "2026-11-01", days: 14 }, "2026-10-25")).toBeNull();
    expect(prepaidReminderDue(period("2026-11-01"), { until: "2026-11-01", days: 14 }, "2026-10-29")).toBe(3);
    expect(prepaidReminderDue(period("2026-11-01"), { until: "2026-11-01", days: 3 }, "2026-10-31")).toBeNull();
  });

  it("sends the 3-day one to a company that missed the 14-day one", () => {
    expect(prepaidReminderDue(period("2026-11-01"), none, "2026-10-30")).toBe(3);
  });

  it("starts afresh once a payment moves the end date", () => {
    expect(prepaidReminderDue(period("2026-12-01"), { until: "2026-11-01", days: 3 }, "2026-11-20")).toBe(14);
  });

  it("skips a lapsed period, no period and a live card subscription", () => {
    expect(prepaidReminderDue(period("2026-10-16"), none, "2026-10-17")).toBeNull();
    expect(prepaidReminderDue(period(null), none, "2026-10-17")).toBeNull();
    expect(prepaidReminderDue(period("2026-10-20", true), none, "2026-10-17")).toBeNull();
  });

  it("still reminds on the last paid day", () => {
    expect(prepaidReminderDue(period("2026-10-17"), { until: "2026-10-17", days: 14 }, "2026-10-17")).toBe(3);
  });
});

describe("planSummary for a demo", () => {
  it("shows the top plan, whatever the billing columns say", () => {
    expect(planSummary({ ...base, isDemo: true }, NOW)).toMatchObject({ plan: "business", source: "demo", enforced: true, trial: null });
  });
});
