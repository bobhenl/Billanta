import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  BANK_TRANSFER_SURCHARGE_PERCENT,
  DEFAULT_TRIAL_DAYS,
  PLAN_PRICES_MINOR,
  TRIAL_PLAN,
  periodPriceMinor,
  transferPriceMinor,
  transferPricesMinor,
  trialDays,
} from "./plans";

describe("transferPriceMinor", () => {
  it("adds the surcharge and rounds up to a whole koruna", () => {
    expect(transferPriceMinor(14900, "CZK")).toBe(16400); // 163.90
    expect(transferPriceMinor(23900, "CZK")).toBe(26300); // 262.90
    expect(transferPriceMinor(10000, "CZK")).toBe(11000); // exact stays exact
  });

  it("rounds euro up to a whole cent", () => {
    expect(transferPriceMinor(599, "EUR")).toBe(659); // 6.589
    expect(transferPriceMinor(1000, "EUR")).toBe(1100);
  });

  it("is always dearer than the card price", () => {
    for (const [, byCurrency] of Object.entries(PLAN_PRICES_MINOR)) {
      for (const [currency, p] of Object.entries(byCurrency) as [ "CZK" | "EUR", { monthly: number; yearly: number }][]) {
        expect(transferPriceMinor(p.monthly, currency)).toBeGreaterThan(p.monthly);
        expect(transferPriceMinor(p.yearly, currency)).toBeGreaterThan(p.yearly);
      }
    }
  });
});

describe("periodPriceMinor by method", () => {
  it("keeps the card price as it was (live subscribers' checkout amount)", () => {
    expect(periodPriceMinor("plus", "CZK", "month")).toBe(28900);
    expect(periodPriceMinor("plus", "CZK", "year", "card")).toBe(239 * 12 * 100);
  });

  it("charges twelve rounded transfer months for a year, not a rounded year", () => {
    expect(periodPriceMinor("plus", "CZK", "year", "transfer")).toBe(263 * 12 * 100);
    expect(periodPriceMinor("start", "CZK", "month", "transfer")).toBe(16400);
  });

  it("lists the same transfer prices the proformas charge", () => {
    expect(transferPricesMinor().business.CZK).toEqual({ monthly: 63700, yearly: 52700 });
  });
});

describe("frontend price list", () => {
  // apps/frontend/lib/plans.ts renders /pricing without the backend, so it
  // carries its own copy of the surcharge; this keeps the two from drifting.
  it("uses the same bank-transfer surcharge", () => {
    const src = readFileSync(join(__dirname, "../../../frontend/lib/plans.ts"), "utf8");
    const m = /BANK_TRANSFER_SURCHARGE_PERCENT\s*=\s*(\d+)/.exec(src);
    expect(Number(m?.[1])).toBe(BANK_TRANSFER_SURCHARGE_PERCENT);
  });
});

describe("welcome trial", () => {
  it("is 14 days of Plus", () => {
    expect(TRIAL_PLAN).toBe("plus");
    expect(DEFAULT_TRIAL_DAYS).toBe(14);
  });

  it("takes TRIAL_DAYS from the env, 0 switches it off, clamped to 90", () => {
    expect(trialDays(undefined)).toBe(DEFAULT_TRIAL_DAYS);
    expect(trialDays(" ")).toBe(DEFAULT_TRIAL_DAYS);
    expect(trialDays("7")).toBe(7);
    expect(trialDays("0")).toBe(0);
    expect(trialDays("-3")).toBe(0);
    expect(trialDays("365")).toBe(90);
    expect(trialDays("abc")).toBe(DEFAULT_TRIAL_DAYS);
  });

  // The SQL bootstrap grants the trial and the frontend advertises it (the
  // signup runs in the frontend without the backend), so each carries a copy.
  it("is granted as TRIAL_PLAN by bootstrap_tenant_for_user", () => {
    const src = readFileSync(join(__dirname, "../../drizzle/rls-policies.sql"), "utf8");
    const fn = src.slice(src.indexOf("CREATE OR REPLACE FUNCTION bootstrap_tenant_for_user("));
    const m = /SET trial_plan = '(\w+)'/.exec(fn);
    expect(m?.[1]).toBe(TRIAL_PLAN);
  });

  it("is advertised with the same plan and length by the frontend", () => {
    const src = readFileSync(join(__dirname, "../../../frontend/lib/plan.ts"), "utf8");
    expect(/export const TRIAL_PLAN[^=]*=\s*'(\w+)'/.exec(src)?.[1]).toBe(TRIAL_PLAN);
    expect(Number(/DEFAULT_TRIAL_DAYS\s*=\s*(\d+)/.exec(src)?.[1])).toBe(DEFAULT_TRIAL_DAYS);
  });
});
