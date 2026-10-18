import { describe, expect, it } from 'vitest';
import { applyTaxCredits, childCreditTotal, compareFlatTaxRegimes, CZ_TAX_YEARS, type FlatTaxComparisonInput, type RegimeKind } from '../index.js';

const y2026 = CZ_TAX_YEARS[2026]!;
const run = (input: Partial<FlatTaxComparisonInput>) =>
  compareFlatTaxRegimes({ year: 2026, income: 800_000, actualExpenses: 0, flatRate: 60, ...input })!;
const option = (r: ReturnType<typeof run>, kind: RegimeKind) => r.options.find((o) => o.kind === kind)!;

describe('paušální daň bands (§ 2a (5) ZDP)', () => {
  it.each([
    // Any activity: band 1 up to 1 M, band 2 up to 1.5 M, band 3 up to 2 M.
    [1_000_000, 40, 1],
    [1_000_001, 40, 2],
    [1_500_000, 40, 2],
    [1_500_001, 40, 3],
    [2_000_000, 40, 3],
    // 60 %: band 1 up to 1.5 M, band 2 up to 2 M.
    [1_500_000, 60, 1],
    [1_500_001, 60, 2],
    [2_000_000, 60, 2],
    // 80 %: band 1 up to 2 M.
    [2_000_000, 80, 1],
  ] as const)('%i Kč at %i %% → band %i', (income, flatRate, band) => {
    const flat = option(run({ income, flatRate }), 'flat_tax');
    expect(flat.band).toBe(band);
    expect(flat.available).toBe(true);
  });

  it('above 2 M the paušální režim is closed, for every activity', () => {
    for (const flatRate of [80, 60, 40, 30] as const) {
      const flat = option(run({ income: 2_000_001, flatRate }), 'flat_tax');
      expect([flatRate, flat.available, flat.reason, flat.total]).toEqual([flatRate, false, 'over_limit', null]);
    }
  });

  it('a VAT payer cannot enter it, even with a small income', () => {
    const flat = option(run({ income: 300_000, vatPayer: true }), 'flat_tax');
    expect([flat.available, flat.reason]).toEqual([false, 'vat_payer']);
    expect(run({ income: 300_000, vatPayer: true }).best).not.toBe('flat_tax');
    // Both reasons at once: the VAT registration is the one to tell.
    expect(option(run({ income: 2_500_000, vatPayer: true }), 'flat_tax').reason).toBe('vat_payer');
  });

  it('2026 band 1 is settled at 12 × 9 162 Kč, band 2 and 3 at the published amounts', () => {
    expect(option(run({ income: 900_000 }), 'flat_tax').total).toBe(109_944);
    expect(option(run({ income: 1_800_000 }), 'flat_tax').total).toBe(12 * 16_745);
    expect(option(run({ income: 1_800_000, flatRate: 40 }), 'flat_tax').total).toBe(12 * 27_139);
  });

  it('a year without parameters gives no comparison at all', () => {
    expect(compareFlatTaxRegimes({ year: 2022, income: 500_000, actualExpenses: 0, flatRate: 60 })).toBeNull();
  });
});

describe('výdajový paušál caps (§ 7 (7) ZDP)', () => {
  it.each([
    [80, 2_000_000, 1_600_000],
    [60, 2_000_000, 1_200_000],
    [60, 3_000_000, 1_200_000],
    [40, 2_000_000, 800_000],
    [30, 2_000_000, 600_000],
    // Under the cap it is the plain share.
    [60, 1_000_000, 600_000],
  ] as const)('%i %% of %i Kč claims %i Kč', (flatRate, income, expenses) => {
    expect(option(run({ income, flatRate }), 'flat_expenses').expenses).toBe(expenses);
  });

  it('actual expenses are used as typed, whatever the activity', () => {
    const r = run({ income: 1_000_000, actualExpenses: 700_000, flatRate: 40 });
    expect(option(r, 'actual_expenses').expenses).toBe(700_000);
    expect(option(r, 'flat_expenses').expenses).toBe(400_000);
  });
});

describe('minimum insurance bases in the regular regime', () => {
  it('a small profit pays the yearly minimums (2026: social 12 × 17 139 × 29.2 %, health 12 × 24 484 × 13.5 %)', () => {
    const o = option(run({ income: 200_000 }), 'flat_expenses');
    expect(o.social).toBe(60_056);
    expect(o.health).toBe(39_665);
    expect(o.tax).toBe(0);
    expect(o.total).toBe(60_056 + 39_665);
  });

  it('so a small trade is cheaper outside the paušální režim', () => {
    const r = run({ income: 200_000 });
    expect(r.best).toBe('flat_expenses');
    expect(r.saving).toBe(109_944 - (60_056 + 39_665));
  });
});

describe('credits (§ 35ba, § 35c ZDP)', () => {
  it('child credits: 15 204, 22 320, then 27 840 for each further child', () => {
    expect(childCreditTotal(y2026, 0)).toBe(0);
    expect(childCreditTotal(y2026, 1)).toBe(15_204);
    expect(childCreditTotal(y2026, 2)).toBe(37_524);
    expect(childCreditTotal(y2026, 3)).toBe(65_364);
    expect(childCreditTotal(y2026, 4)).toBe(93_204);
  });

  it('the taxpayer and spouse credits stop at zero tax, the child credit continues as a bonus', () => {
    expect(applyTaxCredits(40_000, y2026, { income: 500_000 })).toEqual({ tax: 9_160, bonus: 0 });
    expect(applyTaxCredits(40_000, y2026, { income: 500_000, spouse: true })).toEqual({ tax: 0, bonus: 0 });
    expect(applyTaxCredits(40_000, y2026, { income: 500_000, children: 1 })).toEqual({ tax: 0, bonus: 15_204 - 9_160 });
    expect(applyTaxCredits(10_000, y2026, { income: 500_000, children: 2 })).toEqual({ tax: 0, bonus: 37_524 });
  });

  it('no bonus under six times the minimum wage of that year (2026: 134 400 Kč)', () => {
    // 130 000 Kč would qualify under the 2025 wage (124 800) but not under 2026's.
    expect(applyTaxCredits(0, y2026, { income: 130_000, children: 1 }).bonus).toBe(0);
    expect(applyTaxCredits(0, y2026, { income: 134_400, children: 1 }).bonus).toBe(15_204);
    expect(applyTaxCredits(0, CZ_TAX_YEARS[2025]!, { income: 130_000, children: 1 }).bonus).toBe(15_204);
  });

  it('a bonus under 100 Kč is not paid', () => {
    // Tax after the basic credit 15 150 → 15 204 − 15 150 = 54 Kč left.
    expect(applyTaxCredits(30_840 + 15_150, y2026, { income: 500_000, children: 1 })).toEqual({ tax: 0, bonus: 0 });
    expect(applyTaxCredits(30_840 + 15_104, y2026, { income: 500_000, children: 1 })).toEqual({ tax: 0, bonus: 100 });
  });

  it('children can turn the answer: the paušální režim has no credits', () => {
    // 1.2 M at 60 %: profit 480 000, tax 72 000 − 30 840 = 41 160 without children.
    const alone = run({ income: 1_200_000 });
    const parent = run({ income: 1_200_000, children: 3 });
    expect(option(alone, 'flat_expenses').tax).toBe(41_160);
    expect(option(parent, 'flat_expenses').tax).toBe(0);
    expect(option(parent, 'flat_expenses').bonus).toBe(65_364 - 41_160);
    expect(option(alone, 'flat_tax').total).toBe(option(parent, 'flat_tax').total);
    expect(alone.best).toBe('flat_tax');
    expect(parent.best).toBe('flat_expenses');
  });
});

describe('recommendation', () => {
  it('high actual expenses beat both the paušál and the paušální daň', () => {
    const r = run({ income: 1_000_000, actualExpenses: 900_000 });
    expect(r.best).toBe('actual_expenses');
    expect(r.saving).toBe(option(r, 'flat_tax').total! - option(r, 'actual_expenses').total!);
  });

  it('the paušální daň wins: the saving is against the cheaper regular option, not the dearer one', () => {
    const r = run({ income: 1_200_000, actualExpenses: 100_000 });
    expect(r.best).toBe('flat_tax');
    const regular = Math.min(option(r, 'flat_expenses').total!, option(r, 'actual_expenses').total!);
    expect(option(r, 'actual_expenses').total).toBeGreaterThan(regular);
    expect(r.saving).toBe(regular - option(r, 'flat_tax').total!);
  });

  it('the regular regime wins: the saving is against the paušální daň even when the two regular options tie', () => {
    const r = run({ income: 200_000 });
    expect(option(r, 'flat_expenses').total).toBe(option(r, 'actual_expenses').total);
    expect(r.saving).toBe(109_944 - option(r, 'flat_expenses').total!);
  });

  it('without the paušální daň the saving is against the other regular option', () => {
    const r = run({ income: 2_500_000, actualExpenses: 2_000_000 });
    expect(option(r, 'flat_tax').available).toBe(false);
    expect(r.best).toBe('actual_expenses');
    expect(r.saving).toBe(option(r, 'flat_expenses').total! - option(r, 'actual_expenses').total!);
  });

  it('on a tie the regular regime wins over the paušální daň', () => {
    // Actual expenses equal to the paušál: two options with the same total.
    const r = run({ income: 200_000, actualExpenses: 120_000 });
    expect(option(r, 'flat_expenses').total).toBe(option(r, 'actual_expenses').total);
    expect(r.best).toBe('flat_expenses');
  });
});
