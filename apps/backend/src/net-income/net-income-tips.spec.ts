import { describe, expect, it } from "vitest";
import { computeNetIncome } from "./net-income";
import { netIncomeTips } from "./net-income-tips";
import { DEFAULT_TAX_MODEL, RATE_KEYS, type TaxModel, taxModelSchema } from "./tax-model";

const rates = Object.fromEntries(RATE_KEYS.map((k) => [k, DEFAULT_TAX_MODEL[k]]));
const pair = (years: object = {}): TaxModel =>
  taxModelSchema.parse({
    ...DEFAULT_TAX_MODEL,
    partners: [
      { id: "a", name: "A", share: 1, tax_credits: 30_840 },
      { id: "b", name: "B", share: 1, tax_credits: 30_840 },
    ],
    years,
  });
const tipsFor = (model: TaxModel, income: number, year = 2026, months = 12, shares: Record<string, number> | null = null) =>
  netIncomeTips(model, year, computeNetIncome(model, [{ amount: income, shares }], { year, month: 1, months }));
const own = (extra: object = {}) => ({ "2026": { ...rates, partners: {}, ...extra } });
const one = (extra: object = {}) => own({ tax_scope: "one_person", tax_credits: 30_840, ...extra });

describe("netIncomeTips", () => {
  it("shows nothing when the year has its own settings and nothing is off", () => {
    expect(tipsFor(pair(own()), 1_000_000)).toEqual([]);
    expect(tipsFor(pair(one()), 1_000_000)).toEqual([]);
  });

  it("asks for the year's own settings, saying where the rates come from", () => {
    const m = pair({ "2024": { ...rates, partners: {} } });
    expect(tipsFor(m, 1_000_000, 2026)).toEqual([{ code: "year_settings_missing", year: 2026, from: 2024 }]);
    expect(tipsFor(m, 1_000_000, 2023)).toEqual([{ code: "year_settings_missing", year: 2023, from: null }]);
  });

  it("flags missing credits: per partner, or the one taxpayer's", () => {
    expect(tipsFor(pair(own({ partners: { a: { tax_credits: 0 } } })), 1_000_000)).toEqual([{ code: "partner_no_credits", partnerId: "a" }]);
    expect(tipsFor(pair(one({ tax_credits: 0 })), 1_000_000)).toEqual([{ code: "partner_no_credits", partnerId: null }]);
  });

  it("flags the paušál cap for the partner it cuts, or once for one taxpayer", () => {
    expect(tipsFor(pair(own()), 2_600_000, 2026, 12, { a: 12, b: 1 })).toEqual([{ code: "flat_cap_reached", partnerId: "a" }]);
    expect(tipsFor(pair(one()), 2_600_000)).toEqual([{ code: "flat_cap_reached", partnerId: null }]);
  });

  it("suggests one taxpayer when only one partner earns", () => {
    expect(tipsFor(pair(own()), 1_000_000, 2026, 12, { b: 1 })).toEqual([{ code: "single_earner", partnerId: "b" }]);
    expect(tipsFor(pair(one()), 1_000_000, 2026, 12, { b: 1 })).toEqual([]);
    expect(tipsFor(taxModelSchema.parse({ ...DEFAULT_TAX_MODEL, years: own() }), 1_000_000)).toEqual([]);
  });

  it("warns about the 23 % band from the year's average wage, prorated to the period", () => {
    // 2026: 36 × 48 967 = 1 762 812 Kč. 10 M split in two, a 2 M base each without a paušál cap.
    const m = pair(own({ flat_expense_cap: null }));
    expect(tipsFor(m, 10_000_000)).toEqual([
      { code: "high_tax_band", partnerId: "a", limit: 1_762_812 },
      { code: "high_tax_band", partnerId: "b", limit: 1_762_812 },
    ]);
    expect(tipsFor(m, 10_000_000 / 12, 2026, 1).map((t) => t.code)).toEqual(["high_tax_band", "high_tax_band"]);
    expect(tipsFor(m, 7_000_000)).toEqual([]);
    // One taxpayer: 5 M → a 2 M base on the total.
    expect(tipsFor(pair(one({ flat_expense_cap: null })), 5_000_000)).toEqual([{ code: "high_tax_band", partnerId: null, limit: 1_762_812 }]);
    // No parameters for the year in the repo: no band tip rather than a guess.
    expect(tipsFor(pair({ "2040": { ...rates, flat_expense_cap: null, partners: {} } }), 10_000_000, 2040)).toEqual([]);
  });
});
