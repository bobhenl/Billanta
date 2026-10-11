/**
 * The official Czech tax calendar ("Daňový kalendář") published by Finanční
 * správa as a CSV export. Dates in it are already shifted to working days.
 * Each year is fetched once a day and cached in memory; lookups never throw —
 * a network failure returns null and the frontend falls back to computing the
 * common deadlines itself (lib/tax-deadlines.ts).
 */
const FS_URL = "https://financnisprava.gov.cz/App/DanovyKalendar/KalendarCsvExport.aspx";
const TTL_MS = 24 * 60 * 60 * 1000;

/** What a row is about, as far as an invoicing app's users care. */
export type TaxEventKind =
  | "vat" // DPH přiznání, kontrolní hlášení, souhrnné hlášení
  | "vat_other" // OSS, CESOP, SME, skupinová registrace…
  | "income_tax" // přiznání k dani z příjmů
  | "flat_tax" // paušální záloha
  | "payroll" // odvody záloh/srážkové daně zaměstnavatele
  | "road_tax"
  | "property_tax"
  | "other";

export interface TaxEvent {
  /** YYYY-MM-DD */
  date: string;
  tax: string;
  description: string;
  kind: TaxEventKind;
  /** VAT row that also covers quarterly filers ("za 3. čtvrtletí a za září"). */
  quarterly: boolean;
}

const tidy = (s: string) => s.replace(/\s+/g, " ").trim();

/** One `;`-separated CSV line with optional "quoted" fields. */
function splitLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ";") {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

export function classifyTaxEvent(tax: string, description: string): TaxEventKind {
  const t = tax.toLowerCase().replace(/\s+/g, "");
  const d = description.toLowerCase();
  if (t.includes("přidanéhodnoty")) {
    if (/oss|one stop|cesop|sme|registrac|skupin/.test(d)) return "vat_other";
    if (/kontrolní hlášení|souhrnné hlášení|přiznání a splatnost daně za/.test(d)) return "vat";
    return "vat_other";
  }
  if (t.includes("příjmů")) {
    if (d.includes("paušální")) return "flat_tax";
    if (d.includes("přiznání k dani z příjmů")) return "income_tax";
    return "payroll";
  }
  if (t.includes("silniční")) return "road_tax";
  if (t.includes("nemovit")) return "property_tax";
  return "other";
}

/** Parses the `Datum;Dan;Popis` export (dd.mm.yyyy dates). */
export function parseTaxCalendarCsv(text: string): TaxEvent[] {
  const events: TaxEvent[] = [];
  for (const raw of text.replace(/^﻿/, "").split(/\r?\n/).slice(1)) {
    if (!raw.trim()) continue;
    const [date, tax, description] = splitLine(raw);
    const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec((date ?? "").trim());
    if (!m || !tax || !description) continue;
    const cleanTax = tidy(tax);
    const cleanDesc = tidy(description);
    events.push({
      date: `${m[3]}-${m[2]}-${m[1]}`,
      tax: cleanTax,
      description: cleanDesc,
      kind: classifyTaxEvent(cleanTax, cleanDesc),
      quarterly: /čtvrtletí/i.test(cleanDesc),
    });
  }
  return events;
}

const cache = new Map<number, { at: number; events: Promise<TaxEvent[] | null> }>();

async function loadYear(year: number): Promise<TaxEvent[] | null> {
  try {
    const res = await fetch(`${FS_URL}?year=${year}&month=0&lang=cs`, {
      headers: { "user-agent": "Billanta/1.0 (+tax calendar)" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const events = parseTaxCalendarCsv(await res.text());
    return events.length > 0 ? events : null;
  } catch {
    return null;
  }
}

/** All rows for `year`, or null when Finanční správa is unreachable (or hasn't published that year yet). */
export async function getTaxCalendarYear(year: number): Promise<TaxEvent[] | null> {
  const hit = cache.get(year);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.events;
  const events = loadYear(year);
  cache.set(year, { at: Date.now(), events });
  const result = await events;
  // Keep serving a stale year rather than nothing; retry soon after a failure.
  if (!result) {
    if (hit && (await hit.events)) {
      cache.set(year, hit);
      return hit.events;
    }
    cache.delete(year);
  }
  return result;
}

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Official rows from today to `days` ahead (spanning New Year when needed); null = source unavailable. */
export async function upcomingTaxEvents(days: number, now = new Date()): Promise<TaxEvent[] | null> {
  const from = iso(now);
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + days);
  const to = iso(end);
  const years = end.getFullYear() === now.getFullYear() ? [now.getFullYear()] : [now.getFullYear(), end.getFullYear()];
  const lists = await Promise.all(years.map(getTaxCalendarYear));
  // The current year is the one that matters; a missing next year just shortens the window.
  if (!lists[0]) return null;
  return lists
    .flatMap((l) => l ?? [])
    .filter((e) => e.date >= from && e.date <= to)
    .sort((a, b) => a.date.localeCompare(b.date));
}
