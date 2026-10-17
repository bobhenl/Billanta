/**
 * ČNB daily exchange rates (the "kurz devizového trhu" Czech VAT law uses to
 * convert foreign-currency documents to CZK, §38 ZDPH). Ported from
 * faktorio (MIT, © Jiri Spac) – `getCNBExchangeRate.ts`.
 *
 * Each day's list is fetched once and cached in memory (today's list only for
 * an hour, since ČNB publishes around 14:30). Lookups never throw: a network
 * failure returns null and callers decide what to do.
 */
import { CNB_DAILY_URL as CNB_URL, cnbDate, parseCnbDay, type CnbDay } from "@faktur/cz-compliance";

// URL, date format and parser are shared with the public converter page.
export { parseCnbDay, parseCnbRates, type CnbDay, type CnbRate } from "@faktur/cz-compliance";

/** ČNB publishes the daily list since 1991; older dates are rejected. */
export const CNB_EARLIEST = "1991-01-01";
const TODAY_TTL_MS = 60 * 60 * 1000;
const MAX_CACHED_DAYS = 400;

const cache = new Map<string, { pending: Promise<CnbDay | null>; expires: number }>();

/** Test hook: forget every cached day. */
export function clearCnbCache() {
  cache.clear();
}

function pad(n: number) {
  return String(n).padStart(2, "0");
}

/** Local calendar day as YYYY-MM-DD. */
export function isoDay(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

async function loadDay(day: Date): Promise<CnbDay | null> {
  try {
    const res = await fetch(`${CNB_URL}?date=${cnbDate(day)}`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    return parseCnbDay(await res.text());
  } catch {
    return null;
  }
}

/**
 * The ČNB list valid on `date` (today when missing or in the future). ČNB
 * itself answers a weekend, holiday or not-yet-published day with the last
 * published list; `date` in the result says which day that is.
 */
export async function getCnbDay(date?: Date | null): Promise<CnbDay | null> {
  const now = new Date();
  const day = date && date < now ? new Date(date) : now;
  const key = isoDay(day);
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.pending;
  const pending = loadDay(day);
  const expires = key >= isoDay(now) ? Date.now() + TODAY_TTL_MS : Number.POSITIVE_INFINITY;
  cache.delete(key);
  cache.set(key, { pending, expires });
  // Keep memory bounded: Map keeps insertion order, drop the oldest entries.
  while (cache.size > MAX_CACHED_DAYS) cache.delete(cache.keys().next().value!);
  // A failed fetch is not cached; the next call retries.
  void pending.then((result) => {
    if (!result && cache.get(key)?.pending === pending) cache.delete(key);
  });
  return pending;
}

/**
 * CZK per 1 unit of `currency` on `date` (today when missing or in the
 * future). Returns 1 for CZK and null when the rate is not available.
 */
export async function getCnbRate(currency: string, date?: Date | null): Promise<number | null> {
  const code = currency.toUpperCase();
  if (code === "CZK") return 1;
  const day = await getCnbDay(date);
  return day?.rates.get(code)?.rate ?? null;
}

/** Several rates at once (same cached day list); missing ones are null. */
export async function getCnbRates(currencies: string[], date?: Date | null): Promise<Record<string, number | null>> {
  const out: Record<string, number | null> = {};
  for (const c of currencies) out[c.toUpperCase()] = await getCnbRate(c, date);
  return out;
}

/**
 * Validates a requested rate day (YYYY-MM-DD). Missing means today. Returns
 * an error key for a malformed or impossible date, a future day, or a day
 * before ČNB's history starts.
 */
export function parseRateDate(value: string | undefined, now = new Date()): { date: Date } | { error: string } {
  if (value == null || value === "") return { date: now };
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return { error: "date must be YYYY-MM-DD" };
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(d.getTime()) || isoDay(d) !== value) return { error: "date is not a valid calendar day" };
  if (value > isoDay(now)) return { error: "date must not be in the future" };
  if (value < CNB_EARLIEST) return { error: `date must not be before ${CNB_EARLIEST}` };
  return { date: d };
}

/** Validates a comma-separated list of ISO 4217 codes (CZK dropped, duplicates removed). */
export function parseCurrencyList(value: string | undefined, max = 12): { codes: string[] } | { error: string } {
  const raw = (value ?? "EUR,USD,GBP")
    .split(",")
    .map((c) => c.trim().toUpperCase())
    .filter(Boolean);
  if (raw.length === 0) return { error: "currencies must not be empty" };
  const bad = raw.find((c) => !/^[A-Z]{3}$/.test(c));
  if (bad) return { error: `invalid currency code: ${bad.slice(0, 10)}` };
  const codes = [...new Set(raw)].filter((c) => c !== "CZK");
  if (codes.length > max) return { error: `at most ${max} currencies` };
  return { codes };
}
