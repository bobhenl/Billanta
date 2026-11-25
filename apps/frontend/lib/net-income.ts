/** Shapes of `GET /api/v1/net-income` and the tax model (apps/backend/src/net-income). */

export type Shares = Record<string, number>;

export interface TaxPartner {
  id: string;
  name: string;
  share: number;
  tax_credits: number;
}

export interface TaxModel {
  flat_expense_percent: number;
  flat_expense_cap: number | null;
  income_tax_percent: number;
  social_rate_percent: number;
  social_base_percent: number;
  health_rate_percent: number;
  health_base_percent: number;
  partners: TaxPartner[];
  shared_expenses: { label: string; amount: number; per: 'month' | 'year'; shares: Shares | null }[];
  extra_income: { date: string; label: string; amount: number; shares: Shares | null }[];
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

export interface NetIncomeReport {
  period: { year: number; month: number | null; quarter: number | null; months: number; from: string; to: string };
  vatPayer: boolean;
  model: TaxModel;
  result: { months: number; partners: (NetIncomeLine & { id: string; name: string; sharePercent: number })[]; totals: NetIncomeLine };
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
  }[];
  extraIncome: (TaxModel['extra_income'][number] & { index: number })[];
  missingRates: number;
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
