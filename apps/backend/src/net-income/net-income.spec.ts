import { describe, expect, it } from "vitest";
import { allocate, computeNetIncome, sharedExpenseAmount, type Span, splitOf } from "./net-income";
import { creatorShares, DEFAULT_TAX_MODEL, RATE_KEYS, settingsFor, type TaxModel, taxModelOf, taxModelSchema } from "./tax-model";

/** A span starting in January 2026. */
const span = (months: number, month = 1, year = 2026): Span => ({ year, month, months });

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
    const r = computeNetIncome(DEFAULT_TAX_MODEL, [{ amount: 1_000_000, shares: null }], span(12));
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
    const p = computeNetIncome(DEFAULT_TAX_MODEL, [{ amount: 100_000, shares: null }], span(1)).partners[0]!;
    expect(p.credits).toBe(2_570);
    expect(p.incomeTax).toBe(3_430);
    expect(p.social).toBe(6_424);
    expect(p.health).toBe(2_700);
    expect(p.net).toBe(100_000 - 3_430 - 6_424 - 2_700);
  });

  it("caps the flat-rate expenses, prorated in a month", () => {
    expect(computeNetIncome(DEFAULT_TAX_MODEL, [{ amount: 3_000_000, shares: null }], span(12)).partners[0]!.flatExpenses).toBe(1_200_000);
    expect(computeNetIncome(DEFAULT_TAX_MODEL, [{ amount: 300_000, shares: null }], span(1)).partners[0]!.flatExpenses).toBe(100_000);
    const uncapped = { ...DEFAULT_TAX_MODEL, flat_expense_cap: null };
    expect(computeNetIncome(uncapped, [{ amount: 3_000_000, shares: null }], span(12)).partners[0]!.flatExpenses).toBe(1_800_000);
  });

  it("never lets credits push the tax below zero", () => {
    const p = computeNetIncome(DEFAULT_TAX_MODEL, [{ amount: 10_000, shares: null }], span(12)).partners[0]!;
    expect(p.taxBeforeCredits).toBe(600);
    expect(p.credits).toBe(600);
    expect(p.incomeTax).toBe(0);
  });

  it("uses the configured assessment-base share (the old 50 % for social)", () => {
    const old = { ...DEFAULT_TAX_MODEL, social_base_percent: 50 };
    expect(computeNetIncome(old, [{ amount: 1_000_000, shares: null }], span(12)).partners[0]!.social).toBe(58_400);
  });

  it("taxes nothing on a negative period (credit notes)", () => {
    const p = computeNetIncome(DEFAULT_TAX_MODEL, [{ amount: -5_000, shares: null }], span(1)).partners[0]!;
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
      span(1),
    );
    expect(r.partners.map((p) => p.income)).toEqual([533, 533, 2_034]);
    expect(r.totals.income).toBe(3_100);
  });

  it("gives each partner their own credits", () => {
    const r = computeNetIncome(trio, [{ amount: 3_000_000, shares: null }], span(12));
    // 1 M each: base 400 000, tax 60 000.
    expect(r.partners.map((p) => p.incomeTax)).toEqual([29_160, 25_140, 60_000]);
    expect(r.totals.incomeTax).toBe(29_160 + 25_140 + 60_000);
  });

  it("takes shared expenses off the net by their own ratio, monthly × months and yearly prorated", () => {
    // Stored before expenses had dates: no per "once", no date / from / to.
    const model = taxModelSchema.parse({
      ...trio,
      shared_expenses: [
        { label: "Kancelář", amount: 3_000, per: "month", shares: { renzo: 1, montak: 2 } },
        { label: "Software", amount: 12_000, per: "year", shares: null },
      ],
    });
    expect(model.shared_expenses[0]).toMatchObject({ date: null, from: null, to: null });
    // Same in any quarter of any year: nothing limits a legacy expense in time.
    expect(computeNetIncome(model, [], span(3, 10, 2019)).totals.sharedExpenses).toBe(12_000);
    const r = computeNetIncome(model, [], span(3));
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

describe("sharedExpenseAmount, dated expenses", () => {
  const base = { label: "x", amount: 1_200, shares: null, date: null, from: null, to: null };
  const once = { ...base, per: "once" as const, date: "2026-05-20" };

  it("counts a one-off expense only in the month, quarter and year holding its date", () => {
    expect(sharedExpenseAmount(once, span(1, 5))).toBe(1_200);
    expect(sharedExpenseAmount(once, span(1, 4))).toBe(0);
    expect(sharedExpenseAmount(once, span(1, 6))).toBe(0);
    expect(sharedExpenseAmount(once, span(3, 4))).toBe(1_200);
    expect(sharedExpenseAmount(once, span(3, 7))).toBe(0);
    expect(sharedExpenseAmount(once, span(12))).toBe(1_200);
    expect(sharedExpenseAmount(once, span(12, 1, 2025))).toBe(0);
  });

  it("clips a monthly expense to [from, to] by month, both ends inclusive", () => {
    // Hosting since March 2026 (mid-month still counts March), the lease ended in August.
    const hosting = { ...base, per: "month" as const, from: "2026-03-15" };
    expect(sharedExpenseAmount(hosting, span(3))).toBe(1_200); // Q1: March only
    expect(sharedExpenseAmount(hosting, span(1, 2))).toBe(0);
    expect(sharedExpenseAmount(hosting, span(12))).toBe(10 * 1_200);
    expect(sharedExpenseAmount(hosting, span(12, 1, 2027))).toBe(12 * 1_200);
    const lease = { ...base, per: "month" as const, from: "2025-11-01", to: "2026-08-31" };
    expect(sharedExpenseAmount(lease, span(12))).toBe(8 * 1_200);
    expect(sharedExpenseAmount(lease, span(12, 1, 2025))).toBe(2 * 1_200);
    expect(sharedExpenseAmount(lease, span(3, 7))).toBe(2 * 1_200);
    expect(sharedExpenseAmount(lease, span(1, 9))).toBe(0);
  });

  it("prorates a yearly expense per counted month", () => {
    const yearly = { ...base, per: "year" as const, amount: 12_000, to: "2026-02-28" };
    expect(sharedExpenseAmount(yearly, span(12))).toBe(2_000);
    expect(sharedExpenseAmount(yearly, span(3))).toBe(2_000);
    expect(sharedExpenseAmount({ ...yearly, to: null }, span(3, 4))).toBe(3_000);
  });

  it("a span running past December rolls into the next year", () => {
    const jan = { ...once, date: "2027-01-05" };
    expect(sharedExpenseAmount(jan, { year: 2026, month: 12, months: 3 })).toBe(1_200);
  });

  it("needs a date for a one-off expense and an ordered range", () => {
    const m = (e: object) => taxModelSchema.safeParse({ ...trio, shared_expenses: [{ ...base, ...e }] }).success;
    expect(m({ per: "once" })).toBe(false);
    expect(m({ per: "once", date: "2026-05-20" })).toBe(true);
    expect(m({ per: "month", from: "2026-05-01", to: "2026-05-31" })).toBe(true);
    expect(m({ per: "month", from: "2026-06-01", to: "2026-05-31" })).toBe(false);
  });
});

describe("settingsFor, rates per year", () => {
  const year = (income_tax_percent: number, credits: Record<string, number> = {}) => ({
    ...Object.fromEntries(RATE_KEYS.map((k) => [k, DEFAULT_TAX_MODEL[k]])),
    income_tax_percent,
    partners: Object.fromEntries(Object.entries(credits).map(([id, c]) => [id, { tax_credits: c }])),
  });
  const model = taxModelSchema.parse({ ...trio, income_tax_percent: 10, years: { "2024": year(20, { renzo: 1_000 }), "2026": year(30) } });

  it("uses the year's own entry, else the nearest earlier one, else the top level", () => {
    expect(settingsFor(model, 2026)).toMatchObject({ source: 2026, income_tax_percent: 30 });
    expect(settingsFor(model, 2025)).toMatchObject({ source: 2024, income_tax_percent: 20 });
    expect(settingsFor(model, 2030)).toMatchObject({ source: 2026, income_tax_percent: 30 });
    expect(settingsFor(model, 2023)).toMatchObject({ source: null, income_tax_percent: 10 });
  });

  it("takes credits from the entry, a partner it does not list keeps the top-level ones", () => {
    const y = settingsFor(model, 2025).partners;
    expect(y.get("renzo")!.tax_credits).toBe(1_000);
    expect(y.get("montak")!.tax_credits).toBe(30_840 + 4_020);
  });

  it("a legacy model (no years) is computed exactly as before", () => {
    const legacy = taxModelOf({ ...trio, years: undefined });
    expect(legacy.years).toEqual({});
    expect(settingsFor(legacy, 2024)).toMatchObject({ source: null, income_tax_percent: 15 });
    const r = computeNetIncome(legacy, [{ amount: 3_000_000, shares: null }], span(12, 1, 2019));
    expect(r.partners.map((p) => p.incomeTax)).toEqual([29_160, 25_140, 60_000]);
    expect(r.settingsYear).toBeNull();
  });

  it("the report's year picks the rates", () => {
    const items = [{ amount: 300_000, shares: null }];
    // 100 000 each, base 40 000: taxed at 20 %, 30 % and the top-level 10 %.
    expect(computeNetIncome(model, items, span(12, 1, 2025)).partners[2]!.taxBeforeCredits).toBe(8_000);
    expect(computeNetIncome(model, items, span(12, 1, 2026)).partners[2]!.taxBeforeCredits).toBe(12_000);
    expect(computeNetIncome(model, items, span(12, 1, 2023)).partners[2]!.taxBeforeCredits).toBe(4_000);
    // …and the credits: Renzo's 1 000 from the 2024 entry, not his top-level 30 840.
    expect(computeNetIncome(model, items, span(12, 1, 2025)).partners[0]!.credits).toBe(1_000);
  });
});

describe("computeNetIncome, tax_scope", () => {
  const entry = (extra: object) => ({ ...Object.fromEntries(RATE_KEYS.map((k) => [k, DEFAULT_TAX_MODEL[k]])), partners: {}, ...extra });
  const both = (extra: object = {}) => ({
    per: taxModelSchema.parse({ ...trio, years: { "2026": entry(extra) } }),
    one: taxModelSchema.parse({ ...trio, years: { "2026": entry({ tax_scope: "one_person", tax_credits: 30_840, ...extra }) } }),
  });
  const income = [{ amount: 3_000_000, shares: null }];

  it("one_person taxes the total once: the totals equal a single OSVČ's", () => {
    const { one } = both();
    const r = computeNetIncome(one, income, span(12));
    const single = computeNetIncome(DEFAULT_TAX_MODEL, income, span(12)).partners[0]!;
    const { id: _id, name: _name, sharePercent: _s, capped: _c, ...line } = single;
    expect(r.totals).toEqual(line);
    expect(r.taxScope).toBe("one_person");
    // 3 M: the cap bites once (1.2 M) and there is one set of credits.
    expect(r.totals).toMatchObject({ flatExpenses: 1_200_000, base: 1_800_000, credits: 30_840 });
    expect(r.partners.every((p) => p.capped)).toBe(true);
  });

  it("divides every line of the one computation by the income shares", () => {
    const { one } = both();
    const r = computeNetIncome(one, [{ amount: 3_000_000, shares: { renzo: 2, montak: 1 } }], span(12));
    expect(r.partners.map((p) => p.income)).toEqual([2_000_000, 1_000_000, 0]);
    expect(r.partners.map((p) => p.flatExpenses)).toEqual([800_000, 400_000, 0]);
    expect(r.partners.map((p) => p.credits)).toEqual([20_560, 10_280, 0]);
    expect(r.partners.map((p) => p.incomeTax)).toEqual(r.partners.map((p) => p.taxBeforeCredits - p.credits));
    expect(r.partners.map((p) => p.sharePercent)).toEqual([66.7, 33.3, 0]);
    expect(r.totals.taxes).toBe(computeNetIncome(DEFAULT_TAX_MODEL, [{ amount: 3_000_000, shares: null }], span(12)).totals.taxes);
  });

  it("the same income costs more as one taxpayer when the cap and the credits bite", () => {
    const { per, one } = both();
    const a = computeNetIncome(per, income, span(12)).totals;
    const b = computeNetIncome(one, income, span(12)).totals;
    // Per partner: three caps of which none bites (600 000 each), three sets of credits.
    expect(a.flatExpenses).toBe(1_800_000);
    expect(b.flatExpenses).toBe(1_200_000);
    expect(a.credits).toBe(30_840 + 34_860 + 0);
    expect(b.credits).toBe(30_840);
    expect(b.taxes).toBeGreaterThan(a.taxes);
  });

  it("splits shared expenses by their own shares in both modes", () => {
    const { one } = both();
    const withRent = { ...one, shared_expenses: [{ label: "Nájem", amount: 3_000, per: "month" as const, date: null, from: null, to: null, shares: { dusan: 1 } }] };
    expect(computeNetIncome(withRent, income, span(1)).partners.map((p) => p.sharedExpenses)).toEqual([0, 0, 3_000]);
  });

  it("is per partner when nothing says otherwise (legacy and new years)", () => {
    expect(taxModelSchema.parse({ ...trio, years: { "2026": entry({}) } }).years["2026"]!.tax_scope).toBe("per_partner");
    expect(computeNetIncome(trio, income, span(12)).taxScope).toBe("per_partner");
  });
});

describe("creatorShares, partners linked to members", () => {
  const U1 = "11111111-1111-4111-8111-111111111111";
  const U2 = "22222222-2222-4222-8222-222222222222";
  const model = taxModelSchema.parse({
    ...DEFAULT_TAX_MODEL,
    partners: [
      { id: "a", name: "A", share: 50, tax_credits: 0, user_id: U1, claim_own: true },
      { id: "b", name: "B", share: 50, tax_credits: 0, user_id: U2, claim_own: false },
    ],
  });

  it("gives the creator's invoice to their partner when they claim their own", () => {
    expect(creatorShares(model, U1)).toEqual({ a: 1 });
  });

  it("falls back to the default shares for a linked partner who doesn't claim, or nobody", () => {
    expect(creatorShares(model, U2)).toBeNull();
    expect(creatorShares(model, null)).toBeNull();
    expect(creatorShares(model, "33333333-3333-4333-8333-333333333333")).toBeNull();
  });

  it("refuses one member linked to two partners", () => {
    const r = taxModelSchema.safeParse({ ...model, partners: model.partners.map((p) => ({ ...p, user_id: U1 })) });
    expect(r.success).toBe(false);
  });
});
