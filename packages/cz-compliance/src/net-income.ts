import { czTaxYear } from './cz-tax-years.js';
import { isSealed } from './vault/confidential.js';
import type { DocumentAmounts } from './vault-amounts.js';

/*
 * "Po zdanění" (net income): what each partner keeps from a month's,
 * quarter's or year's paid income after income tax, insurance and shared
 * expenses, under the company's own tax model (`tenants.tax_model`, the
 * backend validates it). The server builds the report from the plain
 * documents; with sealed amounts (Důvěrný režim, category "amounts") it
 * hands out the same inputs without those amounts, and the browser opens
 * the envelopes and builds the report here with the same functions.
 */

/** {partnerId: weight}; weights, not percentages. */
export type PartnerShares = Record<string, number>;

export interface NetIncomeRates {
  flat_expense_percent: number;
  /** Yearly cap of the flat-rate expenses per person (Kč); null = none. */
  flat_expense_cap: number | null;
  income_tax_percent: number;
  social_rate_percent: number;
  social_base_percent: number;
  health_rate_percent: number;
  health_base_percent: number;
}

export const NET_INCOME_RATE_KEYS: readonly (keyof NetIncomeRates)[] = [
  'flat_expense_percent',
  'flat_expense_cap',
  'income_tax_percent',
  'social_rate_percent',
  'social_base_percent',
  'health_rate_percent',
  'health_base_percent',
];

export type NetIncomeTaxScope = 'per_partner' | 'one_person';

export interface NetIncomeYearSettings extends NetIncomeRates {
  tax_scope: NetIncomeTaxScope;
  tax_credits: number;
  /**
   * Legacy: the report's own "vedlejší činnost" switch, now set in company
   * settings (NetIncomeActivity). Still read as a whole year in secondary
   * activity while the company has not answered hlavní / vedlejší there.
   */
  secondary_activity?: boolean;
  partners: Record<string, { tax_credits: number }>;
  /**
   * What was really paid for this year (whole Kč), entered after the přiznání
   * and přehledy are filed; null or missing = use the estimate. `actual_refund`
   * is signed: + a doplatek paid later, − a přeplatek refunded.
   */
  actual_tax?: number | null;
  actual_social?: number | null;
  actual_health?: number | null;
  actual_refund?: number | null;
}

/** The actual amounts of a year, each null when not entered. */
export interface NetIncomeActuals {
  incomeTax: number | null;
  social: number | null;
  health: number | null;
  refund: number | null;
}

export interface NetIncomeTaxModel extends NetIncomeRates {
  years: Record<string, NetIncomeYearSettings>;
  partners: { id: string; name: string; share: number; tax_credits: number; user_id?: string | null; claim_own?: boolean }[];
  shared_expenses: {
    label: string;
    amount: number;
    per: 'once' | 'month' | 'year';
    date: string | null;
    from: string | null;
    to: string | null;
    shares: PartnerShares | null;
  }[];
  extra_income: { date: string; label: string; amount: number; shares: PartnerShares | null }[];
}

export interface NetIncomeYear extends NetIncomeRates {
  /** The `years` entry used, or null for the top-level values. */
  source: number | null;
  tax_scope: NetIncomeTaxScope;
  /** "one_person": the taxpayer's credits. */
  tax_credits: number;
  secondary_activity: boolean;
  /** "per_partner": each partner's credits. */
  partners: Map<string, { tax_credits: number }>;
  /** What was really paid, or null for an estimate only (see actualsOf). */
  actual: NetIncomeActuals | null;
}

/**
 * The actual amounts apply only to the year they were entered for, never to
 * a later year that inherits its settings. They are one taxpayer's payments
 * shared out by income, so they count with "one_person" or a single partner;
 * per partner each one files their own, which the model does not track.
 */
function actualsOf(model: NetIncomeTaxModel, entry: NetIncomeYearSettings | undefined): NetIncomeActuals | null {
  if (!entry || (entry.tax_scope !== 'one_person' && model.partners.length !== 1)) return null;
  const actual: NetIncomeActuals = {
    incomeTax: entry.actual_tax ?? null,
    social: entry.actual_social ?? null,
    health: entry.actual_health ?? null,
    refund: entry.actual_refund ?? null,
  };
  return Object.values(actual).some((v) => v != null) ? actual : null;
}

/** The settings in force in `year`: its own entry, else the nearest earlier one, else the top level. */
export function netIncomeSettingsFor(model: NetIncomeTaxModel, year: number): NetIncomeYear {
  const source =
    Object.keys(model.years)
      .map(Number)
      .filter((y) => y <= year)
      .sort((a, b) => b - a)[0] ?? null;
  const entry = source == null ? null : model.years[String(source)]!;
  const rates = entry ?? model;
  const partners = new Map(model.partners.map((p) => [p.id, { tax_credits: entry?.partners[p.id]?.tax_credits ?? p.tax_credits }]));
  return {
    ...(Object.fromEntries(NET_INCOME_RATE_KEYS.map((k) => [k, rates[k]])) as unknown as NetIncomeRates),
    source,
    tax_scope: entry?.tax_scope ?? 'per_partner',
    tax_credits: entry?.tax_credits ?? 0,
    secondary_activity: entry?.secondary_activity ?? false,
    partners,
    actual: actualsOf(model, model.years[String(year)]),
  };
}

/**
 * Whose invoice it is when it has no split of its own: the partner linked to
 * the member who created it, if that partner claims their own invoices;
 * otherwise null, i.e. the default shares.
 */
export function creatorShares(model: NetIncomeTaxModel, createdByUserId: string | null): PartnerShares | null {
  if (!createdByUserId) return null;
  const partner = model.partners.find((p) => p.claim_own && p.user_id === createdByUserId);
  return partner ? { [partner.id]: 1 } : null;
}

/**
 * One piece of income in CZK; `shares` = its own split, null = the default
 * shares. `fees`: what was lost on the way (PayPal's fee, a worse rate), off
 * the net only, since the tax is on the invoiced amount.
 */
export interface NetIncomeItem {
  amount: number;
  shares: PartnerShares | null;
  fees?: number;
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
  /** The year's doplatek (+) or vrácení (−), when entered; 0 otherwise. */
  refund: number;
  taxes: number;
  /** Payment fees and exchange-rate loss (a gain negative). */
  fees: number;
  sharedExpenses: number;
  net: number;
}

export interface NetIncomePartnerLine extends NetIncomeLine {
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
  taxScope: NetIncomeTaxScope;
  /** Which lines hold what was really paid instead of the estimate; null = all estimated. */
  actual: { incomeTax: boolean; social: boolean; health: boolean; refund: boolean } | null;
  partners: NetIncomePartnerLine[];
  totals: NetIncomeLine;
}

/**
 * Fractions per partner id. Unknown ids (a partner removed since) are
 * dropped; a split with nothing left falls back to the default shares.
 */
export function partnerSplitOf(shares: PartnerShares | null, model: NetIncomeTaxModel): Map<string, number> {
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
export function allocateWholeKc(parts: number[]): number[] {
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
export interface NetIncomeSpan {
  year: number;
  month: number;
  months: number;
}

/** "YYYY-MM" of each month in the span. */
function monthsOf(span: NetIncomeSpan): string[] {
  return Array.from({ length: span.months }, (_, i) => {
    const d = span.year * 12 + span.month - 1 + i;
    return `${Math.floor(d / 12)}-${String((d % 12) + 1).padStart(2, '0')}`;
  });
}

/**
 * What one shared expense costs in the span: a one-off one in full when its
 * date falls inside, a recurring one for each month inside [from, to]
 * (monthly × months, yearly at 1/12 per month).
 */
export function sharedExpenseAmount(e: NetIncomeTaxModel['shared_expenses'][number], span: NetIncomeSpan): number {
  const months = monthsOf(span);
  if (e.per === 'once') return e.date && months.includes(e.date.slice(0, 7)) ? e.amount : 0;
  const from = e.from?.slice(0, 7);
  const to = e.to?.slice(0, 7);
  const counted = months.filter((m) => (!from || m >= from) && (!to || m <= to)).length;
  return e.per === 'month' ? e.amount * counted : (e.amount * counted) / 12;
}

function sharedExpenseItems(model: NetIncomeTaxModel, span: NetIncomeSpan): NetIncomeItem[] {
  return model.shared_expenses.map((e) => ({ amount: sharedExpenseAmount(e, span), shares: e.shares }));
}

function splitAmong(model: NetIncomeTaxModel, items: NetIncomeItem[], value: (item: NetIncomeItem) => number = (i) => i.amount): number[] {
  const exact = model.partners.map(() => 0);
  const index = new Map(model.partners.map((p, i) => [p.id, i]));
  for (const item of items) {
    const v = value(item);
    if (v === 0) continue;
    for (const [id, f] of partnerSplitOf(item.shares, model)) exact[index.get(id)!]! += v * f;
  }
  return allocateWholeKc(exact);
}

/**
 * Settings → Company: hlavní or vedlejší činnost (null = not answered) and,
 * for vedlejší, the calendar days it lasts ("YYYY-MM-DD", null = open-ended).
 * Outside those days the activity is the main one.
 */
export interface NetIncomeActivity {
  kind: 'main' | 'secondary' | null;
  from: string | null;
  to: string | null;
}

/** One calendar year month by month (index 0 = January). */
export interface NetIncomeSecondaryYear {
  /** Vedlejší činnost at least part of the month. */
  secondary: boolean[];
  /** Hlavní činnost at least part of the month. */
  main: boolean[];
  /** Where it came from: company settings, the report's legacy switch, or neither (all main). */
  source: 'settings' | 'legacy' | 'none';
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/**
 * The months of `year` in secondary and in main activity. Company settings
 * decide once hlavní / vedlejší is answered there; until then a year the
 * report itself switched to secondary (the old `secondary_activity` flag)
 * counts as secondary all year, so a saved report keeps its figures. The
 * activity is assumed to run the whole year (no start or break dates).
 */
export function netIncomeSecondaryMonths(activity: NetIncomeActivity | null | undefined, model: NetIncomeTaxModel, year: number): NetIncomeSecondaryYear {
  const all = (v: boolean) => Array.from({ length: 12 }, () => v);
  if (activity?.kind === 'secondary') {
    const secondary: boolean[] = [];
    const main: boolean[] = [];
    for (let m = 1; m <= 12; m++) {
      const first = `${year}-${pad2(m)}-01`;
      const last = `${year}-${pad2(m)}-${pad2(new Date(Date.UTC(year, m, 0)).getUTCDate())}`;
      const touches = (!activity.from || activity.from <= last) && (!activity.to || activity.to >= first);
      const covers = (!activity.from || activity.from <= first) && (!activity.to || activity.to >= last);
      secondary.push(touches);
      main.push(!covers);
    }
    return { secondary, main, source: 'settings' };
  }
  if (activity?.kind == null && netIncomeSettingsFor(model, year).secondary_activity) return { secondary: all(true), main: all(false), source: 'legacy' };
  return { secondary: all(false), main: all(true), source: activity?.kind ? 'settings' : 'none' };
}

/** The span's months by activity, with the year's rozhodná částka. */
interface SecondarySpan {
  threshold: number;
  months: number;
  secondary: number;
  main: number;
}

/**
 * The part of the profit that is socially insured when part of the span is
 * in vedlejší činnost.
 *
 * Zákon č. 155/1995 Sb., § 10 odst. 2 and 3 (vedlejší činnost as defined in
 * § 9 odst. 6): a secondary activity is insured only when its income (the
 * daňový základ for social insurance) reaches the rozhodná částka; the
 * částka "se sníží o jednu dvanáctinu" (a twelfth, rounded up) for every
 * whole month without secondary activity. With main and secondary activity in
 * one year, the secondary income is the profit divided by the months with any
 * activity times the months with secondary activity. Months of main activity
 * are always insured: if the secondary part is not, zákon č. 589/1992 Sb.,
 * § 5b odst. 1 counts only the profit divided by the months with any activity
 * times the months with main activity. A month with both counts for both.
 *
 * An estimate: the law tests the whole calendar year's profit. A month or a
 * quarter is tested on its own, against the same share of the yearly částka
 * (a twelfth per month, less a rounded-up twelfth per month without
 * secondary activity), which matches the law only for a whole year.
 */
export function insuredProfitShare(base: number, s: SecondarySpan | null): number {
  if (!s || s.secondary === 0) return 1;
  const limit = (s.threshold * s.months) / 12 - (s.months - s.secondary) * Math.ceil(s.threshold / 12);
  const secondaryIncome = (base / s.months) * s.secondary;
  return secondaryIncome >= limit ? 1 : s.main / s.months;
}

type TaxPart = Omit<NetIncomeLine, 'income' | 'fees' | 'sharedExpenses' | 'net'>;
const TAX_KEYS = ['flatExpenses', 'base', 'taxBeforeCredits', 'credits', 'social', 'health'] as const;

/**
 * One OSVČ's tax on `income` over a `fraction` of the year (cap, credits and
 * the rozhodná částka are yearly). Social insurance only on the insured part
 * of the profit (insuredProfitShare).
 */
function taxOf(income: number, rates: NetIncomeYear, yearlyCredits: number, fraction: number, secondary: SecondarySpan | null): TaxPart & { capped: boolean } {
  const cap = rates.flat_expense_cap == null ? Infinity : rates.flat_expense_cap * fraction;
  const flat = income > 0 ? (income * rates.flat_expense_percent) / 100 : 0;
  const flatExpenses = Math.round(Math.min(flat, cap));
  const base = Math.max(0, income - flatExpenses);
  const taxBeforeCredits = Math.round((base * rates.income_tax_percent) / 100);
  const credits = Math.min(taxBeforeCredits, Math.round(yearlyCredits * fraction));
  const incomeTax = taxBeforeCredits - credits;
  const insured = base * insuredProfitShare(base, secondary);
  const social = Math.round((insured * rates.social_base_percent * rates.social_rate_percent) / 10_000);
  const health = Math.round((base * rates.health_base_percent * rates.health_rate_percent) / 10_000);
  return { flatExpenses, base, taxBeforeCredits, credits, incomeTax, social, health, refund: 0, taxes: incomeTax + social + health, capped: flat > cap };
}

/**
 * The part of the year's actual payments that falls on a span with `income`:
 * its share of the year's income, the way the partners' spreadsheet split it
 * month by month. A whole year takes all of it. Without the year's income
 * (unknown, or nothing earned) the payments still happened, so they are
 * spread evenly over the months instead.
 */
function actualPortion(months: number, income: number, yearIncome: number | null | undefined): number {
  if (months === 12) return 1;
  return yearIncome != null && yearIncome > 0 ? income / yearIncome : months / 12;
}

/**
 * What each partner keeps from `items` over `span` (a month, quarter or year),
 * with the rates and credits of the span's year. "per_partner": each partner
 * is taxed as a separate OSVČ on their share, with their own credits.
 * "one_person": the paušál, its cap, the one set of credits, tax and insurance
 * are worked out once on the total, and every line is then divided by the
 * partners' shares of the income. Either way: flat-rate expenses capped (the
 * yearly cap prorated), credits prorated, social and health insurance from
 * the assessment-base share of the profit. Payment fees and shared business
 * expenses come off the net only, each split by its own shares. Everything is
 * in whole Kč.
 *
 * An estimate: no minimum insurance, no 23 % band, no tax base rounding.
 * Once the year's actual payments are entered, each one replaces its
 * estimated line, split by the partners' income shares; a shorter span takes
 * its part by `yearIncome`, the whole year's income (see actualPortion).
 */
export function computeNetIncome(
  model: NetIncomeTaxModel,
  items: NetIncomeItem[],
  span: NetIncomeSpan,
  activity?: NetIncomeActivity | null,
  yearIncome?: number | null
): NetIncomeResult {
  const { months } = span;
  const fraction = months / 12;
  const rates = netIncomeSettingsFor(model, span.year);
  // An unknown year has no rozhodná částka, so its social insurance stays in.
  const threshold = czTaxYear(span.year)?.social.secondaryThreshold ?? null;
  const byMonth = netIncomeSecondaryMonths(activity, model, span.year);
  const inSpan = (flags: boolean[]) => flags.slice(span.month - 1, span.month - 1 + months).filter(Boolean).length;
  const secondary = threshold == null ? null : { threshold, months, secondary: inSpan(byMonth.secondary), main: inSpan(byMonth.main) };
  const incomes = splitAmong(model, items);
  const fees = splitAmong(model, items, (i) => i.fees ?? 0);
  const expenses = splitAmong(model, sharedExpenseItems(model, span));
  const total = incomes.reduce((s, v) => s + v, 0);
  const weightSum = model.partners.reduce((s, p) => s + p.share, 0);
  const weights = model.partners.map((p, i) => (total !== 0 ? incomes[i]! / total : p.share / weightSum));

  let taxes: (TaxPart & { capped: boolean })[];
  if (rates.tax_scope === 'one_person') {
    const one = taxOf(total, rates, rates.tax_credits, fraction, secondary);
    const parts = Object.fromEntries(TAX_KEYS.map((k) => [k, allocateWholeKc(weights.map((w) => one[k] * w))])) as Record<(typeof TAX_KEYS)[number], number[]>;
    taxes = model.partners.map((_, i) => {
      const line = Object.fromEntries(TAX_KEYS.map((k) => [k, parts[k][i]!])) as Record<(typeof TAX_KEYS)[number], number>;
      const incomeTax = line.taxBeforeCredits - line.credits;
      return { ...line, incomeTax, refund: 0, taxes: incomeTax + line.social + line.health, capped: one.capped };
    });
  } else {
    taxes = model.partners.map((p, i) => taxOf(incomes[i]!, rates, rates.partners.get(p.id)!.tax_credits, fraction, secondary));
  }

  const actual = rates.actual;
  if (actual) {
    const portion = actualPortion(months, total, yearIncome);
    for (const key of ['incomeTax', 'social', 'health', 'refund'] as const) {
      const paid = actual[key];
      if (paid == null) continue;
      const parts = allocateWholeKc(weights.map((w) => paid * portion * w));
      taxes.forEach((line, i) => (line[key] = parts[i]!));
    }
    for (const line of taxes) line.taxes = line.incomeTax + line.social + line.health + line.refund;
  }

  const partners = model.partners.map((p, i): NetIncomePartnerLine => {
    const income = incomes[i]!;
    const sharedExpenses = expenses[i]!;
    return {
      id: p.id,
      name: p.name,
      sharePercent: Math.round(weights[i]! * 1000) / 10,
      income,
      ...taxes[i]!,
      fees: fees[i]!,
      sharedExpenses,
      net: income - taxes[i]!.taxes - fees[i]! - sharedExpenses,
    };
  });

  const sum = (k: keyof NetIncomeLine) => partners.reduce((s, p) => s + p[k], 0);
  const totals: NetIncomeLine = {
    income: sum('income'),
    flatExpenses: sum('flatExpenses'),
    base: sum('base'),
    taxBeforeCredits: sum('taxBeforeCredits'),
    credits: sum('credits'),
    incomeTax: sum('incomeTax'),
    social: sum('social'),
    health: sum('health'),
    refund: sum('refund'),
    taxes: sum('taxes'),
    fees: sum('fees'),
    sharedExpenses: sum('sharedExpenses'),
    net: sum('net'),
  };
  const flags = actual && { incomeTax: actual.incomeTax != null, social: actual.social != null, health: actual.health != null, refund: actual.refund != null };
  return { months, settingsYear: rates.source, taxScope: rates.tax_scope, actual: flags, partners, totals };
}

/** `partnerId: null` = the one taxpayer of a "one_person" year. */
export type NetIncomeTip =
  /** The year runs on another year's settings (or the old top-level ones). */
  | { code: 'year_settings_missing'; year: number; from: number | null }
  | { code: 'partner_no_credits'; partnerId: string | null }
  | { code: 'flat_cap_reached'; partnerId: string | null }
  /** The estimate taxes everything at the basic rate; this base is past the 23 % band (prorated). */
  | { code: 'high_tax_band'; partnerId: string | null; limit: number }
  /** Taxed per partner, but only one of them has income: maybe it is one taxpayer. */
  | { code: 'single_earner'; partnerId: string };

/**
 * Hints that apply to this model and period, each pointing at something the
 * user can change. Nothing generic: no tip when nothing is off.
 */
export function netIncomeTips(model: NetIncomeTaxModel, year: number, result: NetIncomeResult): NetIncomeTip[] {
  const tips: NetIncomeTip[] = [];
  const settings = netIncomeSettingsFor(model, year);
  if (!model.years[String(year)]) tips.push({ code: 'year_settings_missing', year, from: settings.source });

  const params = czTaxYear(year);
  const bandLimit = params ? params.taxHighMultiple * params.averageWage : null;
  const pastBand = (base: number) => bandLimit != null && base > (bandLimit * result.months) / 12;

  if (settings.tax_scope === 'one_person') {
    if (settings.tax_credits === 0) tips.push({ code: 'partner_no_credits', partnerId: null });
    if (result.partners.some((p) => p.capped)) tips.push({ code: 'flat_cap_reached', partnerId: null });
    if (pastBand(result.totals.base)) tips.push({ code: 'high_tax_band', partnerId: null, limit: bandLimit! });
    return tips;
  }

  for (const p of result.partners) {
    if (settings.partners.get(p.id)?.tax_credits === 0) tips.push({ code: 'partner_no_credits', partnerId: p.id });
    if (p.capped) tips.push({ code: 'flat_cap_reached', partnerId: p.id });
    if (pastBand(p.base)) tips.push({ code: 'high_tax_band', partnerId: p.id, limit: bandLimit! });
  }
  const earning = result.partners.filter((p) => p.income > 0);
  if (result.partners.length > 1 && earning.length === 1) tips.push({ code: 'single_earner', partnerId: earning[0]!.id });
  return tips;
}

/* ---- The report, from the server's inputs ---- */

const round2 = (n: number) => Math.round(n * 100) / 100;

/** The period asked for; neither month nor quarter = the whole year. */
export interface NetIncomePeriod {
  year: number;
  /** 1–12, or null. */
  month: number | null;
  /** 1–4, or null. */
  quarter: number | null;
}

/** The period with its length and bounds (calendar days, `to` exclusive). */
export interface NetIncomePeriodRange extends NetIncomePeriod {
  months: number;
  from: string;
  to: string;
}

/** First month (1–12) and length of the period. */
export function netIncomeSpanOf(period: NetIncomePeriod): NetIncomeSpan {
  const first = period.month ? period.month : period.quarter ? (period.quarter - 1) * 3 + 1 : 1;
  return { year: period.year, month: first, months: period.month ? 1 : period.quarter ? 3 : 12 };
}

/** A paid document of the period, as the report lists it. */
export interface NetIncomeInvoice {
  id: string;
  number: string;
  customer: string;
  /** Calendar day paid. */
  paidAt: string;
  month: number;
  currency: string;
  /** In the document's currency, a credit note negative. */
  amount: number;
  /** In CZK at the rate: what the tax is on. */
  income: number;
  /** `income` less what actually arrived in CZK (fees, rate loss; a gain negative); 0 when unknown. */
  fees: number;
  source: 'czk' | 'received' | 'converted';
  partnerShares: PartnerShares | null;
  /** The creator's partner when they claim their own invoices; used when partnerShares is null. */
  claimedShares: PartnerShares | null;
}

/** A paid document with sealed amounts: everything but the amounts, plus its totals envelope and the rate into CZK (null: none found). */
export interface SealedNetIncomeDoc extends Omit<NetIncomeInvoice, 'amount' | 'income' | 'fees' | 'source'> {
  documentType: 'invoice' | 'credit_note';
  encAmounts: string;
  rate: number | null;
}

/** What `GET /net-income/inputs` returns. */
export interface NetIncomeInputs {
  period: NetIncomePeriodRange;
  vatPayer: boolean;
  model: NetIncomeTaxModel;
  /** The plain documents, already in CZK. */
  invoices: NetIncomeInvoice[];
  /** Plain documents left out for want of a rate. */
  missingRates: number;
  sealedDocs: SealedNetIncomeDoc[];
  /** Hlavní / vedlejší činnost from company settings (absent: not answered). */
  activity?: NetIncomeActivity | null;
  /**
   * The whole year's invoice income, for a month or quarter of a year with
   * actual payments entered (they are prorated by it); missing otherwise.
   * `invoices` sums the plain documents in CZK; the sealed ones come as
   * envelopes for the browser to add. Extra income is in the model already.
   */
  yearIncome?: { invoices: number; sealedDocs: Pick<SealedNetIncomeDoc, 'documentType' | 'encAmounts' | 'rate'>[] } | null;
}

export interface NetIncomeReport {
  period: NetIncomePeriodRange;
  vatPayer: boolean;
  model: NetIncomeTaxModel;
  /** What the period was computed with (its year's settings). */
  settings: Omit<NetIncomeYear, 'partners'> & { partners: Record<string, { tax_credits: number }> };
  result: NetIncomeResult;
  tips: NetIncomeTip[];
  /** Hlavní / vedlejší činnost the report was computed with (null: not answered). */
  activity: NetIncomeActivity | null;
  /** The report year month by month in secondary / main activity. */
  secondary: NetIncomeSecondaryYear;
  /** Each month of a quarter or year on its own; null for a month. */
  byMonth: { month: number; income: number; taxes: number; fees: number; sharedExpenses: number; net: number }[] | null;
  invoices: NetIncomeInvoice[];
  extraIncome: (NetIncomeTaxModel['extra_income'][number] & { index: number })[];
  missingRates: number;
}

/**
 * A document's amount for the report, in its own currency: without VAT for
 * a VAT payer, with it otherwise, a credit note negative. The server's plain
 * documents and the browser's sealed ones both use this.
 */
export function netIncomeAmountOf(totals: Pick<DocumentAmounts, 'totalWithoutVat' | 'totalWithVat'>, documentType: string, vatPayer: boolean): number {
  const sign = documentType === 'credit_note' ? -1 : 1;
  return Math.abs(vatPayer ? totals.totalWithoutVat : totals.totalWithVat) * sign;
}

/** The report over the given documents (and the model's extra income); the server and the browser both build it here. */
export function netIncomeReportOf(inputs: Omit<NetIncomeInputs, 'sealedDocs'>): NetIncomeReport {
  const { model, period, invoices } = inputs;
  const span = netIncomeSpanOf(period);
  const extraIncome = model.extra_income.map((e, index) => ({ ...e, index })).filter((e) => e.date >= period.from && e.date < period.to);

  const itemsOf = (month: number | null): NetIncomeItem[] => [
    ...invoices.filter((i) => month == null || i.month === month).map((i) => ({ amount: i.income, fees: i.fees, shares: i.partnerShares ?? i.claimedShares })),
    ...extraIncome.filter((e) => month == null || Number(e.date.slice(5, 7)) === month).map((e) => ({ amount: e.amount, shares: e.shares })),
  ];

  const yearExtra = model.extra_income.filter((e) => e.date.startsWith(`${period.year}-`)).reduce((s, e) => s + e.amount, 0);
  const given = inputs.yearIncome ? inputs.yearIncome.invoices + yearExtra : null;
  // One-off and dated shared expenses are placed by the same calendar months as the extra income above.
  const result = computeNetIncome(model, itemsOf(null), span, inputs.activity, given);
  // A year's own items are its income; the months below take their part of the actual payments by it.
  const yearIncome = span.months === 12 ? result.totals.income : given;
  // Each month on its own (credits and the paušál cap at 1/12), to compare them side by side.
  const byMonth =
    span.months > 1
      ? Array.from({ length: span.months }, (_, i) => {
          const month = span.month + i;
          const r = computeNetIncome(model, itemsOf(month), { year: period.year, month, months: 1 }, inputs.activity, yearIncome);
          return { month, income: r.totals.income, taxes: r.totals.taxes, fees: r.totals.fees, sharedExpenses: r.totals.sharedExpenses, net: r.totals.net };
        })
      : null;

  const settings = netIncomeSettingsFor(model, period.year);
  return {
    period,
    vatPayer: inputs.vatPayer,
    model,
    settings: { ...settings, partners: Object.fromEntries(settings.partners) },
    result,
    tips: netIncomeTips(model, period.year, result),
    activity: inputs.activity ?? null,
    secondary: netIncomeSecondaryMonths(inputs.activity, model, period.year),
    byMonth,
    invoices,
    extraIncome,
    missingRates: inputs.missingRates,
  };
}

/** Every envelope the inputs need opened. */
export function sealedNetIncomeEnvelopes(inputs: Pick<NetIncomeInputs, 'sealedDocs' | 'yearIncome'>): string[] {
  const docs = [...inputs.sealedDocs, ...(inputs.yearIncome?.sealedDocs ?? [])];
  return [...new Set(docs.flatMap((d) => (isSealed(d.encAmounts) ? [d.encAmounts] : [])))];
}

/**
 * The report with the sealed documents opened. A sealed document without a
 * rate is left out like a plain one (in `missingRates`). `report` is null
 * while any document stays shut: figures short of it would look complete.
 */
export function buildSealedNetIncome(inputs: NetIncomeInputs, opened: ReadonlyMap<string, DocumentAmounts>): { report: NetIncomeReport | null; missing: number } {
  let missing = 0;
  let missingRates = inputs.missingRates;
  const sealed: NetIncomeInvoice[] = [];
  for (const doc of inputs.sealedDocs) {
    const totals = opened.get(doc.encAmounts);
    if (!totals) {
      missing++;
      continue;
    }
    if (doc.rate == null) {
      missingRates++;
      continue;
    }
    const amount = netIncomeAmountOf(totals, doc.documentType, inputs.vatPayer);
    sealed.push({
      id: doc.id,
      number: doc.number,
      customer: doc.customer,
      paidAt: doc.paidAt,
      month: doc.month,
      currency: doc.currency,
      amount: round2(amount),
      income: round2(amount * doc.rate),
      fees: 0,
      source: doc.currency === 'CZK' ? 'czk' : 'converted',
      partnerShares: doc.partnerShares,
      claimedShares: doc.claimedShares,
    });
  }
  // The year's sealed documents (the period's among them) join its plain income total.
  let yearIncome = inputs.yearIncome ?? null;
  if (yearIncome) {
    let invoices = yearIncome.invoices;
    const counted = new Set(inputs.sealedDocs.map((d) => d.encAmounts));
    for (const doc of yearIncome.sealedDocs) {
      const totals = opened.get(doc.encAmounts);
      if (!totals) missing += counted.has(doc.encAmounts) ? 0 : 1;
      else if (doc.rate != null) invoices += round2(netIncomeAmountOf(totals, doc.documentType, inputs.vatPayer) * doc.rate);
    }
    yearIncome = { invoices, sealedDocs: [] };
  }
  if (missing > 0) return { report: null, missing };
  // In the order paid, as the server lists them (a stable sort keeps the server's order within a day).
  const invoices = [...inputs.invoices, ...sealed].sort((a, b) => (a.paidAt < b.paidAt ? -1 : a.paidAt > b.paidAt ? 1 : 0));
  return { report: netIncomeReportOf({ ...inputs, invoices, missingRates, yearIncome }), missing: 0 };
}
