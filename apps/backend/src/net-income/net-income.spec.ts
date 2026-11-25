import { describe, expect, it } from "vitest";
import { allocate, computeNetIncome, splitOf } from "./net-income";
import { DEFAULT_TAX_MODEL, type TaxModel, taxModelOf, taxModelSchema } from "./tax-model";

const trio: TaxModel = {
  ...DEFAULT_TAX_MODEL,
  partners: [
    { id: "renzo", name: "Renzo", share: 1, tax_credits: 30_840 },
    { id: "montak", name: "Montak", share: 1, tax_credits: 30_840 + 4_020 },
    { id: "dusan", name: "Dušan", share: 1, tax_credits: 0 },
  ],
};

describe("computeNetIncome, single OSVČ defaults", () => {
  it("a year: 60 % paušál, 15 % tax minus the full credit, 55 % / 50 % assessment bases", () => {
    const r = computeNetIncome(DEFAULT_TAX_MODEL, [{ amount: 1_000_000, shares: null }], 12);
    expect(r.partners[0]).toMatchObject({
      income: 1_000_000,
      flatExpenses: 600_000,
      base: 400_000,
      taxBeforeCredits: 60_000,
      credits: 30_840,
      incomeTax: 29_160,
      social: 64_240,
      health: 27_000,
      taxes: 120_400,
      net: 879_600,
      sharePercent: 100,
    });
  });

  it("a month prorates the credit to 1/12", () => {
    const p = computeNetIncome(DEFAULT_TAX_MODEL, [{ amount: 100_000, shares: null }], 1).partners[0]!;
    expect(p.credits).toBe(2_570);
    expect(p.incomeTax).toBe(3_430);
    expect(p.social).toBe(6_424);
    expect(p.health).toBe(2_700);
    expect(p.net).toBe(100_000 - 3_430 - 6_424 - 2_700);
  });

  it("caps the flat-rate expenses, prorated in a month", () => {
    expect(computeNetIncome(DEFAULT_TAX_MODEL, [{ amount: 3_000_000, shares: null }], 12).partners[0]!.flatExpenses).toBe(1_200_000);
    expect(computeNetIncome(DEFAULT_TAX_MODEL, [{ amount: 300_000, shares: null }], 1).partners[0]!.flatExpenses).toBe(100_000);
    const uncapped = { ...DEFAULT_TAX_MODEL, flat_expense_cap: null };
    expect(computeNetIncome(uncapped, [{ amount: 3_000_000, shares: null }], 12).partners[0]!.flatExpenses).toBe(1_800_000);
  });

  it("never lets credits push the tax below zero", () => {
    const p = computeNetIncome(DEFAULT_TAX_MODEL, [{ amount: 10_000, shares: null }], 12).partners[0]!;
    expect(p.taxBeforeCredits).toBe(600);
    expect(p.credits).toBe(600);
    expect(p.incomeTax).toBe(0);
  });

  it("uses the configured assessment-base share (the old 50 % for social)", () => {
    const old = { ...DEFAULT_TAX_MODEL, social_base_percent: 50 };
    expect(computeNetIncome(old, [{ amount: 1_000_000, shares: null }], 12).partners[0]!.social).toBe(58_400);
  });

  it("taxes nothing on a negative period (credit notes)", () => {
    const p = computeNetIncome(DEFAULT_TAX_MODEL, [{ amount: -5_000, shares: null }], 1).partners[0]!;
    expect(p).toMatchObject({ income: -5_000, flatExpenses: 0, base: 0, taxes: 0, net: -5_000 });
  });
});

describe("computeNetIncome, partners", () => {
  it("splits by default shares and per-item overrides, and the incomes add up", () => {
    const r = computeNetIncome(
      trio,
      [
        { amount: 100, shares: null },
        { amount: 1_000, shares: { renzo: 1, montak: 1 } },
        { amount: 2_000, shares: { dusan: 100 } },
      ],
      1,
    );
    expect(r.partners.map((p) => p.income)).toEqual([533, 533, 2_034]);
    expect(r.totals.income).toBe(3_100);
  });

  it("gives each partner their own credits", () => {
    const r = computeNetIncome(trio, [{ amount: 3_000_000, shares: null }], 12);
    // 1 M each: base 400 000, tax 60 000.
    expect(r.partners.map((p) => p.incomeTax)).toEqual([29_160, 25_140, 60_000]);
    expect(r.totals.incomeTax).toBe(29_160 + 25_140 + 60_000);
  });

  it("takes shared expenses off the net by their own ratio, monthly × months and yearly prorated", () => {
    const model: TaxModel = {
      ...trio,
      shared_expenses: [
        { label: "Kancelář", amount: 3_000, per: "month", shares: { renzo: 1, montak: 2 } },
        { label: "Software", amount: 12_000, per: "year", shares: null },
      ],
    };
    const r = computeNetIncome(model, [], 3);
    expect(r.partners.map((p) => p.sharedExpenses)).toEqual([3_000 + 1_000, 6_000 + 1_000, 1_000]);
    expect(r.partners.map((p) => p.net)).toEqual([-4_000, -7_000, -1_000]);
    // No income: the share shown is the default one.
    expect(r.partners[0]!.sharePercent).toBeCloseTo(33.3, 1);
  });

  it("drops partners that no longer exist from an older split", () => {
    expect([...splitOf({ gone: 1 }, trio).keys()]).toEqual(["renzo", "montak", "dusan"]);
    expect(splitOf({ gone: 1, dusan: 1 }, trio)).toEqual(new Map([["dusan", 1]]));
  });
});

describe("allocate", () => {
  it("rounds parts so they sum to the rounded total", () => {
    expect(allocate([33.333, 33.333, 33.334])).toEqual([33, 33, 34]);
    expect(allocate([0.5, 0.5])).toEqual([0, 1]);
    expect(allocate([])).toEqual([]);
  });
});

describe("taxModelSchema", () => {
  it("accepts the defaults and falls back to them for junk", () => {
    expect(taxModelSchema.safeParse(DEFAULT_TAX_MODEL).success).toBe(true);
    expect(taxModelOf(null)).toEqual(DEFAULT_TAX_MODEL);
    expect(taxModelOf({ partners: [] })).toEqual(DEFAULT_TAX_MODEL);
  });

  it("rejects duplicate partners and all-zero shares", () => {
    const dup = { ...trio, partners: [trio.partners[0]!, trio.partners[0]!] };
    expect(taxModelSchema.safeParse(dup).success).toBe(false);
    const zero = { ...trio, partners: trio.partners.map((p) => ({ ...p, share: 0 })) };
    expect(taxModelSchema.safeParse(zero).success).toBe(false);
  });
});
