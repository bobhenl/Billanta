/**
 * ČNB daily exchange rates (the "kurz devizového trhu" Czech VAT law uses to
 * convert foreign-currency documents to CZK, §38 ZDPH). Ported from
 * faktorio (MIT, © Jiri Spac) — `getCNBExchangeRate.ts`.
 *
 * The rate list is fetched once per day and cached in memory. Lookups never
 * throw: a network failure returns null and callers decide what to do.
 */
const CNB_URL = "https://www.cnb.cz/cs/financni_trhy/devizovy_trh/kurzy_devizoveho_trhu/denni_kurz.txt";
const cache = new Map<string, Promise<Map<string, number> | null>>();

function cnbDate(d: Date): string {
  return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`;
}

/** Parses the pipe-separated list: `země|měna|množství|kód|kurz` after two header lines. */
export function parseCnbRates(text: string): Map<string, number> {
  const rates = new Map<string, number>();
  for (const line of text.split("\n").slice(2)) {
    const parts = line.trim().split("|");
    if (parts.length < 5) continue;
    const amount = Number(parts[2]!.replace(",", "."));
    const rate = Number(parts[4]!.replace(",", "."));
    if (amount > 0 && Number.isFinite(rate)) rates.set(parts[3]!, rate / amount);
  }
  return rates;
}

async function loadDay(key: string): Promise<Map<string, number> | null> {
  try {
    const res = await fetch(`${CNB_URL}?date=${key}`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const rates = parseCnbRates(await res.text());
    return rates.size > 0 ? rates : null;
  } catch {
    return null;
  }
}

/**
 * CZK per 1 unit of `currency` on `date` (today when missing or in the
 * future; ČNB itself answers with the last published rate for weekends and
 * holidays). Returns 1 for CZK and null when the rate is not available.
 */
export async function getCnbRate(currency: string, date?: Date | null): Promise<number | null> {
  const code = currency.toUpperCase();
  if (code === "CZK") return 1;
  const now = new Date();
  const day = date && date < now ? new Date(date) : now;
  const key = cnbDate(day);
  let pending = cache.get(key);
  if (!pending) {
    pending = loadDay(key);
    cache.set(key, pending);
    // A failed fetch is not cached for good; the next call retries.
    void pending.then((rates) => {
      if (!rates) cache.delete(key);
    });
  }
  const rates = await pending;
  return rates?.get(code) ?? null;
}

/** Several rates at once (same cached day list); missing ones are null. */
export async function getCnbRates(currencies: string[], date?: Date | null): Promise<Record<string, number | null>> {
  const out: Record<string, number | null> = {};
  for (const c of currencies) out[c.toUpperCase()] = await getCnbRate(c, date);
  return out;
}
