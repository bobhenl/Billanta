import type { Shares, TaxModel } from "./tax-model";

/** One piece of income in CZK; `shares` = its own split, null = the default shares. */
export interface IncomeItem {
  amount: number;
  shares: Shares | null;
}

export interface NetIncomeLine {
  income: number;
  flatExpenses: number;
  base: number;
  taxBeforeCredits: number;
  credits: number;
  incomeTax: number;
  social: number;
  health: number;
  taxes: number;
  sharedExpenses: number;
  net: number;
}

export interface PartnerLine extends NetIncomeLine {
  id: string;
  name: string;
  /** Share of this period's income, percent (the default share when there is no income). */
  sharePercent: number;
}

export interface NetIncomeResult {
  months: number;
  partners: PartnerLine[];
  totals: NetIncomeLine;
}

/**
 * Fractions per partner id. Unknown ids (a partner removed since) are
 * dropped; a split with nothing left falls back to the default shares.
 */
export function splitOf(shares: Shares | null, model: TaxModel): Map<string, number> {
  const known = new Set(model.partners.map((p) => p.id));
  const own = shares ? Object.entries(shares).filter(([id, w]) => known.has(id) && w > 0) : [];
  const weights = own.length ? own : model.partners.filter((p) => p.share > 0).map((p) => [p.id, p.share] as [string, number]);
  const sum = weights.reduce((s, [, w]) => s + w, 0);
  return new Map(weights.map(([id, w]) => [id, w / sum]));
}

/**
 * Rounds `parts` to whole Kč so they add up to the rounded total: the
 * difference goes to the largest part. Keeps the table summing up exactly.
 */
export function allocate(parts: number[]): number[] {
  const rounded = parts.map((p) => Math.round(p));
  const diff = Math.round(parts.reduce((s, p) => s + p, 0)) - rounded.reduce((s, p) => s + p, 0);
  if (diff !== 0 && parts.length) {
    let big = 0;
    parts.forEach((p, i) => {
      if (Math.abs(p) > Math.abs(parts[big]!)) big = i;
    });
    rounded[big]! += diff;
  }
  return rounded;
}

/** Shared expenses in the period: monthly ones × months, yearly ones prorated. */
function sharedExpenseItems(model: TaxModel, months: number): IncomeItem[] {
  return model.shared_expenses.map((e) => ({ amount: e.per === "month" ? e.amount * months : (e.amount * months) / 12, shares: e.shares }));
}

function splitAmong(model: TaxModel, items: IncomeItem[]): number[] {
  const exact = model.partners.map(() => 0);
  const index = new Map(model.partners.map((p, i) => [p.id, i]));
  for (const item of items) {
    for (const [id, f] of splitOf(item.shares, model)) exact[index.get(id)!]! += item.amount * f;
  }
  return allocate(exact);
}

/**
 * What each partner keeps from `items` over a period of `months` (1, 3 or 12).
 * Each partner is taxed as a separate OSVČ on their share: flat-rate expenses
 * (capped per person, the yearly cap prorated), income tax minus the yearly
 * credits prorated to the period, social and health insurance from their
 * assessment-base share of the profit. Shared business expenses come off the
 * net, split by their own shares. Everything is in whole Kč.
 *
 * An estimate: no minimum insurance, no 23 % band, no tax base rounding.
 */
export function computeNetIncome(model: TaxModel, items: IncomeItem[], months: number): NetIncomeResult {
  const fraction = months / 12;
  const incomes = splitAmong(model, items);
  const expenses = splitAmong(model, sharedExpenseItems(model, months));
  const total = incomes.reduce((s, v) => s + v, 0);
  const weightSum = model.partners.reduce((s, p) => s + p.share, 0);
  const cap = model.flat_expense_cap == null ? Infinity : model.flat_expense_cap * fraction;

  const partners = model.partners.map((p, i): PartnerLine => {
    const income = incomes[i]!;
    const flatExpenses = income > 0 ? Math.round(Math.min((income * model.flat_expense_percent) / 100, cap)) : 0;
    const base = Math.max(0, income - flatExpenses);
    const taxBeforeCredits = Math.round((base * model.income_tax_percent) / 100);
    const credits = Math.min(taxBeforeCredits, Math.round(p.tax_credits * fraction));
    const incomeTax = taxBeforeCredits - credits;
    const social = Math.round((base * model.social_base_percent * model.social_rate_percent) / 10_000);
    const health = Math.round((base * model.health_base_percent * model.health_rate_percent) / 10_000);
    const taxes = incomeTax + social + health;
    const sharedExpenses = expenses[i]!;
    const share = total !== 0 ? (income / total) * 100 : (p.share / weightSum) * 100;
    return {
      id: p.id,
      name: p.name,
      sharePercent: Math.round(share * 10) / 10,
      income,
      flatExpenses,
      base,
      taxBeforeCredits,
      credits,
      incomeTax,
      social,
      health,
      taxes,
      sharedExpenses,
      net: income - taxes - sharedExpenses,
    };
  });

  const sum = (k: keyof NetIncomeLine) => partners.reduce((s, p) => s + p[k], 0);
  const totals: NetIncomeLine = {
    income: sum("income"),
    flatExpenses: sum("flatExpenses"),
    base: sum("base"),
    taxBeforeCredits: sum("taxBeforeCredits"),
    credits: sum("credits"),
    incomeTax: sum("incomeTax"),
    social: sum("social"),
    health: sum("health"),
    taxes: sum("taxes"),
    sharedExpenses: sum("sharedExpenses"),
    net: sum("net"),
  };
  return { months, partners, totals };
}
