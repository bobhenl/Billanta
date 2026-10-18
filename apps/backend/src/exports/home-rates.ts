/**
 * Converting a foreign-currency document into the company's home currency
 * with the rate the home country's VAT law prescribes:
 *  - CZK: the ČNB list valid on the day (§ 38 odst. 1 ZDPH);
 *  - EUR: the ECB reference rate published the day before
 *    (§ 26 ods. 1 zákona č. 222/2004 Z. z.).
 *
 * Every rate here is units of the home currency per 1 unit of `currency`,
 * which is what `invoices.exchange_rate` and `expenses.exchange_rate` store.
 */
import type { HomeCurrency } from "@faktur/cz-compliance";
import { getCnbDay } from "./cnb-rates";
import { getEcbFixing } from "./ecb-rates";

export interface HomeRate {
  rate: number;
  /** Day of the published list the rate comes from (YYYY-MM-DD). */
  date: string;
  source: "cnb" | "ecb";
}

export async function getHomeRateDay(home: HomeCurrency, currency: string, day: Date): Promise<HomeRate | null> {
  const code = currency.toUpperCase();
  if (code === home) return null;
  if (home === "EUR") {
    const fixing = await getEcbFixing(code, day);
    return fixing ? { rate: 1 / fixing.rate, date: fixing.day, source: "ecb" } : null;
  }
  const list = await getCnbDay(day);
  const rate = list?.rates.get(code)?.rate;
  return rate == null ? null : { rate, date: list!.date, source: "cnb" };
}

/** Home currency per 1 unit of `currency`; 1 for the home currency itself, null when unavailable. */
export async function getHomeRate(home: HomeCurrency, currency: string, day?: Date | null): Promise<number | null> {
  if (currency.toUpperCase() === home) return 1;
  return (await getHomeRateDay(home, currency, day ?? new Date()))?.rate ?? null;
}
