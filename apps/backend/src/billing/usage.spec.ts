import { describe, expect, it } from "vitest";
import { featureAccess } from "./plan-access";
import { upgradeFor } from "./plans";
import { LIFETIME_PERIOD, remaining, tasteCounter, usageLimit, usagePeriod } from "./usage";

describe("usagePeriod", () => {
  it("is the calendar month in Prague, not in UTC", () => {
    // 23:30 UTC on 31 Jan is already 1 Feb in Prague (UTC+1).
    expect(usagePeriod(new Date("2026-01-31T23:30:00Z"))).toBe("2026-02");
    // 22:30 UTC on 31 Jul is 00:30 on 1 Aug in summer time (UTC+2).
    expect(usagePeriod(new Date("2026-07-31T22:30:00Z"))).toBe("2026-08");
    expect(usagePeriod(new Date("2026-07-31T21:30:00Z"))).toBe("2026-07");
  });
});

describe("usageLimit", () => {
  it("holds an enforced company to its plan's limit", () => {
    expect(usageLimit({ plan: "free", enforced: true }, "documents")).toBe(10);
    expect(usageLimit({ plan: "start", enforced: true }, "documents")).toBeNull();
    expect(usageLimit({ plan: "plus", enforced: true }, "ai_credits")).toBe(150);
    expect(usageLimit({ plan: "free", enforced: true }, "api_requests")).toBe(0);
  });

  it("never limits a company from before plan limits", () => {
    expect(usageLimit({ plan: "free", enforced: false }, "documents")).toBeNull();
    expect(usageLimit({ plan: "free", enforced: false }, "ai_credits")).toBeNull();
    expect(usageLimit(null, "documents")).toBeNull();
  });
});

describe("tasteCounter", () => {
  const now = new Date("2026-03-10T12:00:00Z");
  it("counts a monthly taste per month and a one-off for the company's life", () => {
    expect(tasteCounter("accounting_export", now)).toEqual({ metric: "taste_accounting_export", period: "2026-03", uses: 1 });
    expect(tasteCounter("vat_filings", now)).toEqual({ metric: "taste_vat_filings", period: LIFETIME_PERIOD, uses: 1 });
  });

  it("is null for a feature without a taste", () => {
    expect(tasteCounter("webhooks", now)).toBeNull();
  });
});

describe("remaining", () => {
  it("never goes below zero and is null when unlimited", () => {
    expect(remaining(10, 7)).toBe(3);
    expect(remaining(10, 12)).toBe(0);
    expect(remaining(null, 500)).toBeNull();
  });
});

describe("featureAccess", () => {
  it("is open on the feature's plan whatever the taste count", () => {
    expect(featureAccess({ plan: "plus", enforced: true }, "vat_filings", 5)).toBe("plan");
    expect(featureAccess({ plan: "free", enforced: false }, "vat_filings", 5)).toBe("plan");
  });

  it("offers the taste below the plan until it is used up", () => {
    expect(featureAccess({ plan: "start", enforced: true }, "vat_filings", 0)).toBe("taste");
    expect(featureAccess({ plan: "start", enforced: true }, "vat_filings", 1)).toBe("locked");
    expect(featureAccess({ plan: "free", enforced: true }, "accounting_export", 0)).toBe("taste");
  });

  it("locks a feature without a taste below its plan", () => {
    expect(featureAccess({ plan: "free", enforced: true }, "webhooks", 0)).toBe("locked");
  });
});

describe("upgradeFor", () => {
  it("names the cheapest plan with more", () => {
    expect(upgradeFor("documents", "free")).toBe("start");
    expect(upgradeFor("ai_credits", "start")).toBe("plus");
    expect(upgradeFor("api_requests", "free")).toBe("start");
  });

  it("is null at the top or when already unlimited", () => {
    expect(upgradeFor("ai_credits", "business")).toBeNull();
    expect(upgradeFor("documents", "start")).toBeNull();
  });
});
