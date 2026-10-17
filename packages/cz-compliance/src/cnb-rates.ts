/**
 * ČNB daily exchange rate list ("kurz devizového trhu", the rate Czech VAT
 * law uses to convert foreign-currency documents to CZK, § 38 ZDPH). Ported
 * from faktorio (MIT, © Jiri Spac), `getCNBExchangeRate.ts`. Only the URL and
 * the parsing live here; the backend keeps its own per-day cache, the public
 * converter page lets Next cache the fetch.
 */
export const CNB_DAILY_URL = 'https://www.cnb.cz/cs/financni_trhy/devizovy_trh/kurzy_devizoveho_trhu/denni_kurz.txt';

/** `?date=` value ČNB expects: DD.MM.YYYY. */
export function cnbDate(d: Date): string {
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
}

/** Parses the pipe-separated list: `země|měna|množství|kód|kurz` after two header lines. CZK per 1 unit. */
export function parseCnbRates(text: string): Map<string, number> {
  const rates = new Map<string, number>();
  for (const line of text.split('\n').slice(2)) {
    const parts = line.trim().split('|');
    if (parts.length < 5) continue;
    const amount = Number(parts[2]!.replace(',', '.'));
    const rate = Number(parts[4]!.replace(',', '.'));
    if (amount > 0 && Number.isFinite(rate)) rates.set(parts[3]!, rate / amount);
  }
  return rates;
}

/** The date the list was published for, from its first line (`17.10.2026 #201`), as YYYY-MM-DD. */
export function parseCnbListDate(text: string): string | null {
  const m = /^(\d{2})\.(\d{2})\.(\d{4})/.exec(text.trim());
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}
