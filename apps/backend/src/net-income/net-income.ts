import { type ResolvedYear, type Shares, settingsFor, type TaxModel } from "./tax-model";

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
  /** The paušál was cut down to the (prorated) cap. */
  capped: boolean;
}

export interface NetIncomeResult {
  months: number;
  /** The `years` entry the rates came from, null = the top-level ones. */
  settingsYear: number | null;
  taxScope: ResolvedYear["tax_scope"];
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

/** A run of whole calendar months: `month` is the first one (1–12), `months` is 1, 3 or 12. */
export interface Span {
  year: number;
  month: number;
  months: number;
}

/** "YYYY-MM" of each month in the span. */
function monthsOf(span: Span): string[] {
  return Array.from({ length: span.months }, (_, i) => {
    const d = span.year * 12 + span.month - 1 + i;
    return `${Math.floor(d / 12)}-${String((d % 12) + 1).padStart(2, "0")}`;
  });
}

/**
 * What one shared expense costs in the span: a one-off one in full when its
 * date falls inside, a recurring one for each month inside [from, to]
 * (monthly × months, yearly at 1/12 per month).
 */
export function sharedExpenseAmount(e: TaxModel["shared_expenses"][number], span: Span): number {
  const months = monthsOf(span);
  if (e.per === "once") return e.date && months.includes(e.date.slice(0, 7)) ? e.amount : 0;
  const from = e.from?.slice(0, 7);
  const to = e.to?.slice(0, 7);
  const counted = months.filter((m) => (!from || m >= from) && (!to || m <= to)).length;
  return e.per === "month" ? e.amount * counted : (e.amount * counted) / 12;
}

function sharedExpenseItems(model: TaxModel, span: Span): IncomeItem[] {
  return model.shared_expenses.map((e) => ({ amount: sharedExpenseAmount(e, span), shares: e.shares }));
}

function splitAmong(model: TaxModel, items: IncomeItem[]): number[] {
  const exact = model.partners.map(() => 0);
  const index = new Map(model.partners.map((p, i) => [p.id, i]));
  for (const item of items) {
    for (const [id, f] of splitOf(item.shares, model)) exact[index.get(id)!]! += item.amount * f;
  }
  return allocate(exact);
}

type TaxPart = Omit<NetIncomeLine, "income" | "sharedExpenses" | "net">;
const TAX_KEYS = ["flatExpenses", "base", "taxBeforeCredits", "credits", "social", "health"] as const;

/** One OSVČ's tax on `income` over a `fraction` of the year (cap and credits are yearly). */
function taxOf(income: number, rates: ResolvedYear, yearlyCredits: number, fraction: number): TaxPart & { capped: boolean } {
  const cap = rates.flat_expense_cap == null ? Infinity : rates.flat_expense_cap * fraction;
  const flat = income > 0 ? (income * rates.flat_expense_percent) / 100 : 0;
  const flatExpenses = Math.round(Math.min(flat, cap));
  const base = Math.max(0, income - flatExpenses);
  const taxBeforeCredits = Math.round((base * rates.income_tax_percent) / 100);
  const credits = Math.min(taxBeforeCredits, Math.round(yearlyCredits * fraction));
  const incomeTax = taxBeforeCredits - credits;
  const social = Math.round((base * rates.social_base_percent * rates.social_rate_percent) / 10_000);
  const health = Math.round((base * rates.health_base_percent * rates.health_rate_percent) / 10_000);
  return { flatExpenses, base, taxBeforeCredits, credits, incomeTax, social, health, taxes: incomeTax + social + health, capped: flat > cap };
}

/**
 * What each partner keeps from `items` over `span` (a month, quarter or year),
 * with the rates and credits of the span's year. "per_partner": each partner
 * is taxed as a separate OSVČ on their share, with their own credits.
 * "one_person": the paušál, its cap, the one set of credits, tax and insurance
 * are worked out once on the total, and every line is then divided by the
 * partners' shares of the income. Either way: flat-rate expenses capped (the
 * yearly cap prorated), credits prorated, social and health insurance from
 * the assessment-base share of the profit. Shared business expenses come off
 * the net, split by their own shares. Everything is in whole Kč.
 *
 * An estimate: no minimum insurance, no 23 % band, no tax base rounding.
 */
export function computeNetIncome(model: TaxModel, items: IncomeItem[], span: Span): NetIncomeResult {
  const { months } = span;
  const fraction = months / 12;
  const rates = settingsFor(model, span.year);
  const incomes = splitAmong(model, items);
  const expenses = splitAmong(model, sharedExpenseItems(model, span));
  const total = incomes.reduce((s, v) => s + v, 0);
  const weightSum = model.partners.reduce((s, p) => s + p.share, 0);
  const weights = model.partners.map((p, i) => (total !== 0 ? incomes[i]! / total : p.share / weightSum));

  let taxes: (TaxPart & { capped: boolean })[];
  if (rates.tax_scope === "one_person") {
    const one = taxOf(total, rates, rates.tax_credits, fraction);
    const parts = Object.fromEntries(TAX_KEYS.map((k) => [k, allocate(weights.map((w) => one[k] * w))])) as Record<(typeof TAX_KEYS)[number], number[]>;
    taxes = model.partners.map((_, i) => {
      const line = Object.fromEntries(TAX_KEYS.map((k) => [k, parts[k][i]!])) as Record<(typeof TAX_KEYS)[number], number>;
      const incomeTax = line.taxBeforeCredits - line.credits;
      return { ...line, incomeTax, taxes: incomeTax + line.social + line.health, capped: one.capped };
    });
  } else {
    taxes = model.partners.map((p, i) => taxOf(incomes[i]!, rates, rates.partners.get(p.id)!.tax_credits, fraction));
  }

  const partners = model.partners.map((p, i): PartnerLine => {
    const income = incomes[i]!;
    const sharedExpenses = expenses[i]!;
    return {
      id: p.id,
      name: p.name,
      sharePercent: Math.round(weights[i]! * 1000) / 10,
      income,
      ...taxes[i]!,
      sharedExpenses,
      net: income - taxes[i]!.taxes - sharedExpenses,
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
  return { months, settingsYear: rates.source, taxScope: rates.tax_scope, partners, totals };
}
