/**
 * "Podklady pro daňové přiznání": one tax year of a sole trader's own
 * figures laid out for the return. The caller sums the year (income from
 * paid invoices, expenses by category, in the home currency); this module
 * adds what the return needs on top: the výdajové paušály against the
 * actual expenses, the paušální daň question (CZ only), the filing
 * deadlines and the rough tax and insurance under each option.
 *
 * Every rate and limit comes from the year tables (cz-tax-years.ts,
 * osvc-annual.ts, sk-szco-annual.ts). A year without published parameters
 * gets the sums and the deadlines but no comparison (`params: false`), never
 * the nearest year's numbers: the helpers there fall back to the closest
 * year for the calculators, so the year is checked here first.
 *
 * Used by the in-app page, its CSV / PDF and the dashboard nudge.
 */
import { compareFlatTaxRegimes, type FlatTaxComparison } from './flat-tax-comparison.js';
import { czTaxYear } from './cz-tax-years.js';
import { computeOsvcAnnualSummary, OSVC_FLAT_EXPENSE_CAPS, type OsvcFlatRate } from './osvc-annual.js';
import { nextWorkingDay } from './public-holidays.js';
import { computeSkSzcoAnnualSummary, SK_FLAT_EXPENSE_CAP, SK_FLAT_EXPENSE_SHARE, SK_TAX_YEARS } from './sk-szco-annual.js';

export type TaxReturnCountry = 'CZ' | 'SK';

export interface TaxReturnBasisInput {
  country: TaxReturnCountry;
  year: number;
  /** Income from the year's paid invoices (credit notes subtracted), home currency, without VAT for a VAT payer. */
  income: number;
  /** Actual expenses by category (null / empty = uncategorised), home currency. */
  expensesByCategory: Record<string, number>;
  vatPayer: boolean;
  /** s.r.o. and other companies file DPPO / DPPO-SK: no paušály, no paušální daň. */
  legalEntity: boolean;
  /** CZ: the activity, which decides the paušál (80 / 60 / 40 / 30 %). Ignored for SK (one 60 % paušál). */
  flatRate?: OsvcFlatRate;
  /** SK: the poistné paid in the year, deductible on top of either kind of expenses (§ 6 ods. 10 / 11 ZDP). */
  paidSocial?: number;
  paidHealth?: number;
}

export interface FlatExpenseRow {
  /** Share of income, in % (80 / 60 / 40 / 30 in CZ, 60 in SK). */
  rate: number;
  /** Yearly cap of the paušál, home currency. */
  cap: number;
  amount: number;
  /** The cap, not the share, decided the amount. */
  capped: boolean;
}

/** The return under one kind of expenses: what is claimed, the profit and the rough yearly cost. */
export interface ExpenseOption {
  kind: 'flat_expenses' | 'actual_expenses';
  expenses: number;
  profit: number;
  tax: number;
  social: number | null;
  health: number;
  /** Tax + the year's insurance (CZ: social and health; SK: health and the poistné paid). */
  total: number;
}

export type TaxReturnDeadlineKind = 'paper' | 'electronic' | 'advisor' | 'extended';

export interface TaxReturnDeadline {
  kind: TaxReturnDeadlineKind;
  /** Already moved to the next working day (§ 33 (4) daňového řádu, § 27 ods. 2 daňového poriadku). */
  date: Date;
}

export interface TaxReturnBasis {
  country: TaxReturnCountry;
  year: number;
  currency: 'CZK' | 'EUR';
  income: number;
  actualExpenses: number;
  /** Largest first; the uncategorised bucket is `category: null`. */
  categories: { category: string | null; amount: number }[];
  /** Published parameters exist for the year (the comparison below is filled only then). */
  params: boolean;
  /** A company: only the sums and the deadlines apply. */
  legalEntity: boolean;
  flatExpenses: FlatExpenseRow[];
  /** The chosen activity's paušál against the actual expenses. */
  chosen: { rate: number; flat: number; actual: number; better: 'flat' | 'actual' | 'equal' } | null;
  options: ExpenseOption[] | null;
  /** CZ sole traders only. */
  flatTax: FlatTaxComparison | null;
  deadlines: TaxReturnDeadline[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** The day the return for `taxYear` is due, by filing route. */
export function taxReturnDeadlines(country: TaxReturnCountry, taxYear: number): TaxReturnDeadline[] {
  const next = taxYear + 1;
  if (country === 'SK') {
    return [
      // § 49 ods. 2 ZDP (595/2003 Z. z.): do troch mesiacov po skončení zdaňovacieho obdobia.
      { kind: 'paper', date: nextWorkingDay(new Date(next, 2, 31), 'SK') },
      // § 49 ods. 3 písm. a) ZDP: oznámením správcovi dane najviac o tri celé kalendárne mesiace.
      { kind: 'extended', date: nextWorkingDay(new Date(next, 5, 30), 'SK') },
    ];
  }
  return [
    // § 136 odst. 1 zákona č. 280/2009 Sb.: do 3 měsíců po uplynutí zdaňovacího období (1. 4.).
    { kind: 'paper', date: nextWorkingDay(new Date(next, 3, 1), 'CZ') },
    // § 136 odst. 2 písm. b): podané elektronicky (dálkovým přístupem) o měsíc později.
    { kind: 'electronic', date: nextWorkingDay(new Date(next, 4, 1), 'CZ') },
    // § 136 odst. 2 písm. a): zpracované a podané daňovým poradcem do 6 měsíců.
    { kind: 'advisor', date: nextWorkingDay(new Date(next, 6, 1), 'CZ') },
  ];
}

/** Category sums, largest first, empty and zero buckets dropped, keys normalised (blank = null). */
export function sortExpenseCategories(byCategory: Record<string, number>): { category: string | null; amount: number }[] {
  const merged = new Map<string | null, number>();
  for (const [key, value] of Object.entries(byCategory)) {
    const k = key.trim() ? key.trim() : null;
    merged.set(k, (merged.get(k) ?? 0) + value);
  }
  return [...merged]
    .map(([category, amount]) => ({ category, amount: round2(amount) }))
    .filter((c) => c.amount !== 0)
    // Largest first; the uncategorised bucket last among equals, then by key.
    .sort((a, b) => b.amount - a.amount || (a.category == null ? 1 : b.category == null ? -1 : a.category.localeCompare(b.category)));
}

export function computeTaxReturnBasis(input: TaxReturnBasisInput): TaxReturnBasis {
  const sk = input.country === 'SK';
  const income = round2(Math.max(0, input.income));
  const categories = sortExpenseCategories(input.expensesByCategory);
  const actual = round2(Math.max(0, categories.reduce((s, c) => s + c.amount, 0)));
  const params = sk ? input.year in SK_TAX_YEARS : czTaxYear(input.year) != null;
  const base: TaxReturnBasis = {
    country: input.country,
    year: input.year,
    currency: sk ? 'EUR' : 'CZK',
    income,
    actualExpenses: actual,
    categories,
    params,
    legalEntity: input.legalEntity,
    flatExpenses: [],
    chosen: null,
    options: null,
    flatTax: null,
    deadlines: taxReturnDeadlines(input.country, input.year),
  };
  // Paušály are § 7 ZDP (CZ) / § 6 ods. 10 ZDP (SK) for natural persons; a company has none.
  if (input.legalEntity) return base;

  if (sk) {
    // § 6 ods. 10 ZDP: 60 % of income, at most 20 000 € a year (the cap is not year-dependent since 2022).
    const share = Math.round(SK_FLAT_EXPENSE_SHARE * 100);
    const byShare = Math.floor(income * SK_FLAT_EXPENSE_SHARE * 100) / 100;
    const flat = Math.min(byShare, SK_FLAT_EXPENSE_CAP);
    base.flatExpenses = [{ rate: share, cap: SK_FLAT_EXPENSE_CAP, amount: flat, capped: byShare > SK_FLAT_EXPENSE_CAP }];
    base.chosen = { rate: share, flat, actual, better: better(flat, actual) };
    if (!params) return base;
    const run = (flatRate: boolean): ExpenseOption => {
      const s = computeSkSzcoAnnualSummary({ year: input.year, income, actualExpenses: actual, flatRate, paidSocial: input.paidSocial, paidHealth: input.paidHealth });
      return {
        kind: flatRate ? 'flat_expenses' : 'actual_expenses',
        expenses: s.expenses,
        profit: s.profit,
        tax: s.tax.total,
        social: s.social.paid,
        health: s.health.total,
        total: s.totalBurden,
      };
    };
    base.options = [run(true), run(false)];
    return base;
  }

  const rate = input.flatRate ?? 60;
  base.flatExpenses = (Object.keys(OSVC_FLAT_EXPENSE_CAPS) as unknown as OsvcFlatRate[])
    .map(Number)
    .sort((a, b) => b - a)
    .map((r) => {
      const cap = OSVC_FLAT_EXPENSE_CAPS[r as OsvcFlatRate];
      const byShare = round2((income * r) / 100);
      return { rate: r, cap, amount: Math.min(byShare, cap), capped: byShare > cap };
    });
  const flat = base.flatExpenses.find((f) => f.rate === rate)!.amount;
  base.chosen = { rate, flat, actual, better: better(flat, actual) };
  if (!params) return base;

  // The regime comparison carries the credits and the child bonus; without
  // family data it uses the basic taxpayer credit only, like the estimate.
  const cmp = compareFlatTaxRegimes({ year: input.year, income, actualExpenses: actual, flatRate: rate, vatPayer: input.vatPayer });
  base.flatTax = cmp;
  base.options = (['flat_expenses', 'actual_expenses'] as const).map((kind) => {
    const o = cmp!.options.find((x) => x.kind === kind)!;
    const s = computeOsvcAnnualSummary({ year: input.year, income, actualExpenses: actual, flatRate: kind === 'flat_expenses' ? rate : null });
    return { kind, expenses: s.expenses, profit: s.profit, tax: o.tax!, social: o.social, health: o.health!, total: o.total! };
  });
  return base;
}

const better = (flat: number, actual: number): 'flat' | 'actual' | 'equal' => (flat > actual ? 'flat' : flat < actual ? 'actual' : 'equal');

/**
 * The spring window for the nudge (dashboard card, weekly digest): January
 * to March, about the year that just ended. Null outside it. `now` is read
 * in Prague time so a Monday-morning cron run on 1 April UTC still says
 * April.
 */
export function taxReturnSeason(now: Date): { taxYear: number } | null {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Prague', year: 'numeric', month: 'numeric' }).formatToParts(now);
  const year = Number(parts.find((p) => p.type === 'year')!.value);
  const month = Number(parts.find((p) => p.type === 'month')!.value);
  return month >= 1 && month <= 3 ? { taxYear: year - 1 } : null;
}
