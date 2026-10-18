/**
 * ČNB daily exchange rate list ("kurz devizového trhu", the rate Czech VAT
 * law uses to convert foreign-currency documents to CZK, § 38 ZDPH). Ported
 * from faktorio (MIT, © Jiri Spac), `getCNBExchangeRate.ts`. Only the URL and
 * the parsing live here; the backend keeps its own per-day cache, the public
 * converter page lets Next cache the fetch.
 */
export const CNB_DAILY_URL = 'https://www.cnb.cz/cs/financni_trhy/devizovy_trh/kurzy_devizoveho_trhu/denni_kurz.txt';

export interface CnbRate {
  /** CZK per 1 unit. */
  rate: number;
  country: string;
  name: string;
}

export interface CnbDay {
  /** The day the list was published (YYYY-MM-DD); for weekends and holidays the last working day before. */
  date: string;
  rates: Map<string, CnbRate>;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** `?date=` value ČNB expects: DD.MM.YYYY. */
export function cnbDate(d: Date): string {
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
}

/**
 * Parses the pipe-separated list: a `DD.MM.YYYY #n` header, a column line
 * (`země|měna|množství|kód|kurz`), then one row per currency. Rates are
 * normalised to 1 unit (ČNB quotes e.g. 100 JPY).
 */
export function parseCnbDay(text: string): CnbDay | null {
  const lines = text.split(/\r?\n/);
  const header = /^(\d{2})\.(\d{2})\.(\d{4})/.exec(lines[0]?.trim() ?? '');
  if (!header) return null;
  const rates = new Map<string, CnbRate>();
  for (const line of lines.slice(2)) {
    const parts = line.trim().split('|');
    if (parts.length < 5) continue;
    const code = parts[3]!.trim().toUpperCase();
    const amount = Number(parts[2]!.replace(',', '.'));
    const rate = Number(parts[4]!.replace(',', '.'));
    if (/^[A-Z]{3}$/.test(code) && amount > 0 && Number.isFinite(rate) && rate > 0) {
      rates.set(code, { rate: rate / amount, country: parts[0]!.trim(), name: parts[1]!.trim() });
    }
  }
  if (rates.size === 0) return null;
  return { date: `${header[3]}-${header[2]}-${header[1]}`, rates };
}

/** Code → CZK per unit (for callers that only need the numbers). */
export function parseCnbRates(text: string): Map<string, number> {
  const day = parseCnbDay(text);
  return new Map([...(day?.rates ?? [])].map(([code, r]) => [code, r.rate]));
}
