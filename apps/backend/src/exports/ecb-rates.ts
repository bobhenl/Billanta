/**
 * ECB euro reference rates, which Slovak VAT law uses to convert
 * foreign-currency documents to EUR: the rate published the day before
 * the tax point (§ 26 ods. 1 zákona č. 222/2004 Z. z.).
 *
 * Each (currency, day) lookup is cached in memory. Lookups never throw: a
 * network failure returns null and callers decide what to do.
 */
const ECB_URL = "https://data-api.ecb.europa.eu/service/data/EXR";
/** Weekends and TARGET holidays: look this many days back for the last fixing. */
const LOOKBACK_DAYS = 10;
const MAX_CACHED = 1000;

/** A published fixing: units of the currency per 1 EUR, and its day (YYYY-MM-DD). */
export interface EcbFixing {
  rate: number;
  day: string;
}

const cache = new Map<string, Promise<EcbFixing | null>>();

/** Test hook: forget every cached rate. */
export function clearEcbCache() {
  cache.clear();
}

const pad = (n: number) => String(n).padStart(2, "0");
const isoDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/**
 * The last observation on or before `upTo` (YYYY-MM-DD) from an ECB
 * `format=csvdata` response, in units of the currency per 1 EUR.
 */
export function parseEcbCsv(csv: string, upTo: string): number | null {
  return parseEcbFixing(csv, upTo)?.rate ?? null;
}

export function parseEcbFixing(csv: string, upTo: string): EcbFixing | null {
  const lines = csv.trim().split(/\r?\n/);
  const head = lines.shift()?.split(",") ?? [];
  const day = head.indexOf("TIME_PERIOD");
  const value = head.indexOf("OBS_VALUE");
  if (day < 0 || value < 0) return null;
  let best: EcbFixing | null = null;
  for (const line of lines) {
    const cols = line.split(",");
    const d = cols[day]!;
    const rate = Number(cols[value]);
    if (!d || d > upTo || !Number.isFinite(rate) || rate <= 0) continue;
    if (!best || d > best.day) best = { day: d, rate };
  }
  return best;
}

async function load(code: string, upTo: Date): Promise<EcbFixing | null> {
  const from = new Date(upTo);
  from.setDate(from.getDate() - LOOKBACK_DAYS);
  const url = `${ECB_URL}/D.${code}.EUR.SP00.A?startPeriod=${isoDay(from)}&endPeriod=${isoDay(upTo)}&format=csvdata`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    return parseEcbFixing(await res.text(), isoDay(upTo));
  } catch {
    return null;
  }
}

/**
 * Units of `currency` per 1 EUR for a document whose tax point is
 * `taxPoint`: the last ECB fixing before that day. Returns 1 for EUR and
 * null when the rate is not available.
 */
export async function getEcbRate(currency: string, taxPoint: Date): Promise<number | null> {
  if (currency.toUpperCase() === "EUR") return 1;
  return (await getEcbFixing(currency, taxPoint))?.rate ?? null;
}

/** The fixing `getEcbRate` uses, with the day it was published. EUR has none (null). */
export async function getEcbFixing(currency: string, taxPoint: Date): Promise<EcbFixing | null> {
  const code = currency.toUpperCase();
  if (code === "EUR") return null;
  if (!/^[A-Z]{3}$/.test(code)) return null;
  const dayBefore = new Date(taxPoint);
  dayBefore.setDate(dayBefore.getDate() - 1);
  const now = new Date();
  const upTo = dayBefore < now ? dayBefore : now;
  const key = `${code}:${isoDay(upTo)}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const pending = load(code, upTo);
  cache.set(key, pending);
  while (cache.size > MAX_CACHED) cache.delete(cache.keys().next().value!);
  // A failed fetch is not cached; the next call retries.
  void pending.then((fixing) => {
    if (fixing == null && cache.get(key) === pending) cache.delete(key);
  });
  return pending;
}
