/**
 * "Jednotný kurz" (§ 38 odst. 1 zákona o daních z příjmů): one rate per
 * currency for a whole year, which a company may use for income tax instead
 * of the daily rate. GFŘ publishes it after the year ends as the average of
 * the ČNB rates valid on the last day of each of the 12 months, so we can
 * compute it ourselves from the same lists, and a running value for the
 * current year from the months that are over.
 *
 * Only for reports and the income-tax estimate. VAT (and so every printed
 * document) needs the ČNB rate of the day the liability arose (§ 38 ZDPH).
 */
import type { HomeCurrency } from "@faktur/cz-compliance";
import { annualRateFor, exchangeRateSettingsOf, rateYearOf, type AnnualRate } from "../invoices/exchange-rate-mode";
import { getCnbDay } from "./cnb-rates";

export interface UniformRate {
  /** CZK per 1 unit. */
  rate: number;
  /** How many month-end rates the average is made of. */
  months: number;
  /** All 12 months are in: the value GFŘ publishes. */
  final: boolean;
}

/**
 * The average of the month-end rates that are known (index 0 = January;
 * null for a month that is not over yet or whose list could not be loaded),
 * rounded to 4 decimals. Null when no month is known.
 */
export function uniformRateOf(monthEnds: readonly (number | null | undefined)[]): UniformRate | null {
  const known = monthEnds.slice(0, 12).filter((r): r is number => typeof r === "number" && Number.isFinite(r) && r > 0);
  if (known.length === 0) return null;
  const avg = known.reduce((a, b) => a + b, 0) / known.length;
  return { rate: Math.round(avg * 10_000) / 10_000, months: known.length, final: known.length === 12 };
}

/** Last days of the months of `year` that are over by `now` (local time). */
export function finishedMonthEnds(year: number, now = new Date()): Date[] {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const out: Date[] = [];
  for (let m = 0; m < 12; m++) {
    const last = new Date(year, m + 1, 0);
    if (last < today) out.push(last);
  }
  return out;
}

/**
 * The computed jednotný kurz of every ČNB currency for `year`. The ČNB
 * lists come from the shared per-day cache, so past years cost nothing
 * after the first call.
 */
export async function computeUniformRates(year: number, now = new Date()): Promise<Map<string, UniformRate>> {
  const days = await Promise.all(finishedMonthEnds(year, now).map((d) => getCnbDay(d)));
  const codes = new Set(days.flatMap((d) => (d ? [...d.rates.keys()] : [])));
  const out = new Map<string, UniformRate>();
  for (const code of codes) {
    const rate = uniformRateOf(days.map((d) => d?.rates.get(code)?.rate ?? null));
    if (rate) out.set(code, rate);
  }
  return out;
}

/**
 * The rate reports convert a foreign amount with, per the company's
 * Settings → Faktury → Kurz choice: the document's own rate ("daily"), or
 * the jednotný kurz of the year (the company's own for that year first,
 * then the computed one, then the document's rate when neither exists).
 * The jednotný kurz is Czech; a Slovak company (home EUR) always reports
 * at the document's own rate.
 */
export class ReportRates {
  private readonly years = new Map<number, Promise<Map<string, UniformRate>>>();

  constructor(
    readonly annual: boolean,
    private readonly overrides: readonly AnnualRate[],
    private readonly now = new Date(),
    readonly home: HomeCurrency = "CZK",
  ) {}

  static fromPrefs(prefs: unknown, now = new Date(), home: HomeCurrency = "CZK"): ReportRates {
    const s = exchangeRateSettingsOf(prefs);
    return new ReportRates(home === "CZK" && s.reportMode === "annual", s.annualRates, now, home);
  }

  /** Jednotný kurz for `currency` in `year`, or null when there is none yet. */
  async uniform(currency: string, year: number): Promise<number | null> {
    const own = annualRateFor(this.overrides, currency, year);
    if (own != null) return own;
    let pending = this.years.get(year);
    if (!pending) {
      pending = computeUniformRates(year, this.now);
      this.years.set(year, pending);
    }
    return (await pending).get(currency.toUpperCase())?.rate ?? null;
  }

  /**
   * Home currency per unit for an amount in `currency` dated `day` whose document
   * stores `stored`. `year` overrides the year of `day` (the annual summary
   * converts a whole tax year with that year's rate).
   */
  async rate(currency: string, stored: number | null, day: Date, year?: number): Promise<number | null> {
    if (currency === this.home) return 1;
    const own = stored != null && Number.isFinite(stored) && stored > 0 ? stored : null;
    if (!this.annual) return own;
    return (await this.uniform(currency, year ?? rateYearOf(day))) ?? own;
  }
}
