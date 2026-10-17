import { createHash } from "node:crypto";
import type { LegislationDataset } from "@faktur/cz-compliance";

/**
 * Official pages the tax constants depend on. Each source keeps only the part
 * that matters (form codes with versions, amounts), so a redesign of the
 * page's menu or a cookie banner does not raise an alert, while a new form
 * version or a changed amount does.
 */
export interface LegislationSource {
  key: string;
  url: string;
  datasets: LegislationDataset[];
  /** What a change means, for the alert text. */
  label: string;
  /** Global regexes over the page text; the matches, in order, are the relevant part. */
  patterns: RegExp[];
}

export const LEGISLATION_SOURCES: LegislationSource[] = [
  {
    key: "epo_forms",
    url: "https://adisspr.mfcr.cz/dpr/adis/idpr_pub/epo2_info/popis_struktury_seznam.faces",
    datasets: ["vat_forms", "dpfo_form"],
    label: "EPO form list (DPHDP3, DPHKH1, DPHSHV, DPFDP)",
    // "DPHDP3 Přiznání k dani z přidané hodnoty 03.01.04": code, name, version.
    patterns: [/\b(?:DPHDP\d|DPHKH\d|DPHSHV|DPFDP\d+)\b[^0-9]{0,160}\d{2}\.\d{2}\.\d{2}/g],
  },
  {
    key: "cssz_osvc_schema",
    url: "https://www.cssz.gov.cz/definice-e-podani-osvc",
    datasets: ["cssz_form"],
    label: "ČSSZ e-podání OSVČ (přehled XML schema)",
    patterns: [/\bOSVC ?(?:20)?\d{2}\b[^.\n]{0,80}/g],
  },
  {
    key: "cssz_minimums",
    url: "https://www.cssz.gov.cz/vyse-minimalnich-vymerovacich-zakladu-osvc",
    datasets: ["osvc_minimums"],
    label: "ČSSZ minimum bases and advances for OSVČ",
    patterns: [/\b20\d{2}\b/g, /\d{1,3}(?: \d{3})+(?:,\d+)? ?Kč/g],
  },
  {
    key: "fs_flat_tax",
    url: "https://financnisprava.gov.cz/cs/dane/dane/dan-z-prijmu/pausalni-dan",
    datasets: ["flat_tax"],
    label: "Finanční správa: paušální daň",
    patterns: [/\d{1,2} \d{3} Kč/g, /pro rok 20\d{2}/gi],
  },
  {
    key: "fs_press",
    url: "https://financnisprava.gov.cz/cs/financni-sprava/media-a-verejnost/tiskove-zpravy-gfr",
    datasets: ["flat_tax", "osvc_minimums"],
    label: "Finanční správa press releases about advances or paušální daň",
    patterns: [/[^.!?]{0,120}(?:paušáln|zálohy|zálohu|minimální)[^.!?]{0,120}/gi],
  },
];

/** Page text without markup, scripts and runs of whitespace. */
export function pageText(html: string): string {
  return html
    .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;| /g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

/** The relevant part of a page, or null when no pattern matched (the page changed shape). */
export function relevantPart(source: LegislationSource, html: string): string | null {
  const text = pageText(html);
  const parts: string[] = [];
  for (const re of source.patterns) {
    for (const m of text.matchAll(re)) parts.push(m[0].trim());
  }
  return parts.length ? parts.join("\n") : null;
}

export const hashPart = (part: string) => createHash("sha256").update(part).digest("hex");

export type CheckOutcome =
  | { status: "baseline" | "unchanged" | "changed"; hash: string; excerpt: string }
  | { status: "error"; error: string };

/** Compare a fetched page with the stored hash. */
export function compare(source: LegislationSource, html: string, storedHash: string | null): CheckOutcome {
  const part = relevantPart(source, html);
  if (part == null) return { status: "error", error: "relevant_part_not_found" };
  const hash = hashPart(part);
  const excerpt = part.slice(0, 2000);
  if (storedHash == null) return { status: "baseline", hash, excerpt };
  return { status: hash === storedHash ? "unchanged" : "changed", hash, excerpt };
}

/**
 * The "last checked" day per dataset: the oldest confirmation among its
 * sources, so one unreviewed change holds the whole group back. A dataset
 * with a source that was never confirmed gets null (callers fall back to
 * the manual date).
 */
export function datasetDates(rows: { key: string; confirmedAt: Date | null }[]): Partial<Record<LegislationDataset, string | null>> {
  const byKey = new Map(rows.map((r) => [r.key, r.confirmedAt]));
  const out: Partial<Record<LegislationDataset, string | null>> = {};
  const datasets = new Set(LEGISLATION_SOURCES.flatMap((s) => s.datasets));
  for (const d of datasets) {
    let oldest: Date | null = null;
    let missing = false;
    for (const s of LEGISLATION_SOURCES.filter((x) => x.datasets.includes(d))) {
      const at = byKey.get(s.key) ?? null;
      if (!at) missing = true;
      else if (!oldest || at < oldest) oldest = at;
    }
    out[d] = missing || !oldest ? null : oldest.toISOString().slice(0, 10);
  }
  return out;
}
