import { describe, expect, it } from "vitest";
import { computeAnnualSummary, paidAdvances, paramsFor } from "./annual-summary";

describe("paidAdvances", () => {
  const history = [
    { from: "2025-01", social: 4759, health: 3143 },
    { from: "2026-01", social: 5720 },
    { from: "2026-07", social: 5005 },
  ];

  it("sums the advances in force in each month of the year", () => {
    const p = paidAdvances(history, 2026, {});
    expect(p.paidSocial).toBe(6 * 5720 + 6 * 5005);
    expect(p.paidHealth).toBe(12 * 3143);
    expect(p.source).toEqual({ social: "settings", health: "settings" });
    expect(paidAdvances(history, 2025, {}).paidSocial).toBe(12 * 4759);
  });

  it("a typed amount wins; nothing set = no amount", () => {
    const p = paidAdvances(history, 2026, { paidSocial: 1000 });
    expect(p.paidSocial).toBe(1000);
    expect(p.source.social).toBe("input");
    const none = paidAdvances(history, 2024, {});
    expect(none.paidSocial).toBeUndefined();
    expect(none.source).toEqual({ social: null, health: null });
  });
});

describe("computeAnnualSummary", () => {
  it("60 % flat-rate trade with 1 M income in 2025", () => {
    const s = computeAnnualSummary({ year: 2025, income: 1_000_000, actualExpenses: 50_000, flatRate: 60 });
    expect(s.expenses).toBe(600_000);
    expect(s.profit).toBe(400_000);
    expect(s.tax.total).toBe(60_000 - 30_840);
    // 55 % of profit (220 000) is above the minimum base (12 × 16 295).
    expect(s.social.total).toBe(Math.ceil(220_000 * 0.292));
    // 50 % of profit (200 000) is under the minimum (12 × 23 279), so the minimum applies.
    expect(s.health.base).toBe(23_279 * 12);
  });

  it("caps flat-rate expenses and uses actual ones when no flat rate", () => {
    expect(computeAnnualSummary({ year: 2025, income: 3_000_000, actualExpenses: 0, flatRate: 60 }).expenses).toBe(1_200_000);
    expect(computeAnnualSummary({ year: 2025, income: 500_000, actualExpenses: 120_000, flatRate: null }).expenses).toBe(120_000);
  });

  it("taxes the part above 36 average wages at 23 % and never goes negative", () => {
    const high = computeAnnualSummary({ year: 2025, income: 3_000_000, actualExpenses: 0, flatRate: null });
    const threshold = 36 * 46_557;
    expect(high.tax.beforeCredit).toBe(Math.ceil(threshold * 0.15 + (3_000_000 - threshold) * 0.23));
    expect(computeAnnualSummary({ year: 2025, income: 100_000, actualExpenses: 0, flatRate: 60 }).tax.total).toBe(0);
  });

  it("reports the balance against paid advances and falls back to the nearest known year", () => {
    const s = computeAnnualSummary({ year: 2025, income: 0, actualExpenses: 0, flatRate: null, paidSocial: 50_000 });
    expect(s.social.balance).toBe(s.social.total - 50_000);
    expect(paramsFor(2030).exact).toBe(false);
  });
});
