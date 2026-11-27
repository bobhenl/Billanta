/** Shapes of `GET /api/v1/net-income` and the tax model (apps/backend/src/net-income). */

export type Shares = Record<string, number>;

/** A team member a partner can be linked to (from GET /api/v1/team). */
export interface PartnerMember {
  userId: string;
  label: string;
}

export interface TaxPartner {
  id: string;
  name: string;
  share: number;
  tax_credits: number;
  /** The team member this partner is (users.id). */
  user_id?: string | null;
  /** Invoices that member creates count as theirs unless split by hand. */
  claim_own?: boolean;
}

export interface TaxRates {
  flat_expense_percent: number;
  flat_expense_cap: number | null;
  income_tax_percent: number;
  social_rate_percent: number;
  social_base_percent: number;
  health_rate_percent: number;
  health_base_percent: number;
}

export const RATE_KEYS: (keyof TaxRates)[] = [
  'flat_expense_percent',
  'flat_expense_cap',
  'income_tax_percent',
  'social_rate_percent',
  'social_base_percent',
  'health_rate_percent',
  'health_base_percent'
];

export type TaxScope = 'per_partner' | 'one_person';

/** One calendar year's settings; partners themselves stay global. */
export interface YearSettings extends TaxRates {
  tax_scope: TaxScope;
  /** The one taxpayer's yearly credits ('one_person'). */
  tax_credits: number;
  secondary_activity?: boolean;
  partners: Record<string, { tax_credits: number }>;
}

export interface SharedExpense {
  label: string;
  amount: number;
  per: 'once' | 'month' | 'year';
  /** 'once' only. */
  date: string | null;
  /** Recurring: first and last month (YYYY-MM-DD, by month); null = open. */
  from: string | null;
  to: string | null;
  shares: Shares | null;
}

export interface TaxModel extends TaxRates {
  partners: TaxPartner[];
  shared_expenses: SharedExpense[];
  extra_income: { date: string; label: string; amount: number; shares: Shares | null }[];
  /** "2024" → that year's settings; a year without one uses the nearest earlier, else the top level. */
  years: Record<string, YearSettings>;
}

/** Mirrors settingsFor in apps/backend/src/net-income/tax-model.ts. */
export function yearSource(model: TaxModel, year: number): number | null {
  return (
    Object.keys(model.years)
      .map(Number)
      .filter((y) => y <= year)
      .sort((a, b) => b - a)[0] ?? null
  );
}

/** The settings in force in `year`, as a full entry (the top level filled in when no year applies). */
export function resolvedYear(model: TaxModel, year: number): YearSettings {
  const source = yearSource(model, year);
  const entry = source == null ? null : model.years[String(source)]!;
  const rates = entry ?? model;
  return {
    ...(Object.fromEntries(RATE_KEYS.map((k) => [k, rates[k]])) as unknown as TaxRates),
    tax_scope: entry?.tax_scope ?? 'per_partner',
    tax_credits: entry?.tax_credits ?? 0,
    secondary_activity: entry?.secondary_activity ?? false,
    partners: Object.fromEntries(model.partners.map((p) => [p.id, { tax_credits: entry?.partners[p.id]?.tax_credits ?? p.tax_credits }]))
  };
}

export type NetIncomeTip =
  | { code: 'year_settings_missing'; year: number; from: number | null }
  | { code: 'partner_no_credits'; partnerId: string | null }
  | { code: 'flat_cap_reached'; partnerId: string | null }
  | { code: 'high_tax_band'; partnerId: string | null; limit: number }
  | { code: 'single_earner'; partnerId: string };

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

export interface NetIncomeReport {
  period: { year: number; month: number | null; quarter: number | null; months: number; from: string; to: string };
  vatPayer: boolean;
  model: TaxModel;
  /** The settings the period was computed with. */
  settings: TaxRates & { source: number | null; tax_scope: TaxScope; tax_credits: number; partners: Record<string, { tax_credits: number }> };
  result: {
    months: number;
    settingsYear: number | null;
    taxScope: TaxScope;
    partners: (NetIncomeLine & { id: string; name: string; sharePercent: number; capped: boolean })[];
    totals: NetIncomeLine;
  };
  tips: NetIncomeTip[];
  byMonth: { month: number; income: number; taxes: number; sharedExpenses: number; net: number }[] | null;
  invoices: {
    id: string;
    number: string;
    customer: string;
    paidAt: string;
    currency: string;
    amount: number;
    income: number;
    source: 'czk' | 'received' | 'converted';
    partnerShares: Shares | null;
    /** The creator's partner when they claim their own invoices; applies while partnerShares is null. */
    claimedShares: Shares | null;
  }[];
  extraIncome: (TaxModel['extra_income'][number] & { index: number })[];
  missingRates: number;
  /** Paid documents with sealed amounts, left out of `result` by the server (the browser adds them after unlock). */
  sealed?: { count: number; ids: string[] };
}

export type PeriodKind = 'month' | 'quarter' | 'year';

export interface Period {
  kind: PeriodKind;
  year: number;
  /** 1–12 for a month, 1–4 for a quarter, 0 for a year. */
  n: number;
}

/** `?year=&month=` / `?year=&quarter=` / `?year=`; this month when nothing (valid) is given. */
export function parsePeriod(sp: { year?: string; month?: string; quarter?: string; view?: string }, now = new Date()): Period {
  const year = Number(sp.year);
  const y = Number.isInteger(year) && year >= 2000 && year <= 2100 ? year : now.getFullYear();
  const month = Number(sp.month);
  const quarter = Number(sp.quarter);
  if (Number.isInteger(month) && month >= 1 && month <= 12) return { kind: 'month', year: y, n: month };
  if (Number.isInteger(quarter) && quarter >= 1 && quarter <= 4) return { kind: 'quarter', year: y, n: quarter };
  if (sp.year) return { kind: 'year', year: y, n: 0 };
  return { kind: 'month', year: now.getFullYear(), n: now.getMonth() + 1 };
}

export function shiftPeriod(p: Period, dir: 1 | -1): Period {
  if (p.kind === 'year') return { ...p, year: p.year + dir };
  const size = p.kind === 'month' ? 12 : 4;
  const i = p.year * size + (p.n - 1) + dir;
  return { kind: p.kind, year: Math.floor(i / size), n: (i % size) + 1 };
}

/** The same moment seen as another kind: November → Q4 → the year → January (or the current month). */
export function switchKind(p: Period, kind: PeriodKind, now = new Date()): Period {
  if (kind === 'year') return { kind, year: p.year, n: 0 };
  const month = p.kind === 'month' ? p.n : p.kind === 'quarter' ? (p.n - 1) * 3 + 1 : p.year === now.getFullYear() ? now.getMonth() + 1 : 1;
  return kind === 'month' ? { kind, year: p.year, n: month } : { kind, year: p.year, n: Math.ceil(month / 3) };
}

export function periodQuery(p: Period): string {
  return p.kind === 'month' ? `year=${p.year}&month=${p.n}` : p.kind === 'quarter' ? `year=${p.year}&quarter=${p.n}` : `year=${p.year}`;
}

/** Whole Kč, the way the report rounds. */
export function formatKc(amount: number, locale: string): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency: 'CZK', maximumFractionDigits: 0 }).format(amount);
}
