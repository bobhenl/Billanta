/**
 * Tiny RFC 5545 writer for the read-only calendar feed: all-day events only,
 * which is all the feed needs (tax deadlines, invoice due dates).
 */
export interface IcsEvent {
  /** Stable per event so calendar apps update instead of duplicating. */
  uid: string;
  /** YYYY-MM-DD */
  date: string;
  summary: string;
  description?: string;
  url?: string;
  categories?: string[];
}

const esc = (v: string) => v.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

/** Folds a content line to ≤ 75 octets (continuation lines start with a space). */
function fold(line: string): string {
  const bytes = Buffer.from(line, "utf8");
  if (bytes.length <= 75) return line;
  const parts: string[] = [];
  let cur = "";
  let size = 0;
  for (const ch of line) {
    const n = Buffer.byteLength(ch, "utf8");
    if (size + n > (parts.length ? 74 : 75)) {
      parts.push(cur);
      cur = "";
      size = 0;
    }
    cur += ch;
    size += n;
  }
  parts.push(cur);
  return parts.join("\r\n ");
}

const ymd = (iso: string) => iso.replace(/-/g, "");
function nextDay(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const next = new Date(Date.UTC(y!, m! - 1, d! + 1));
  return next.toISOString().slice(0, 10);
}
const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

export function buildIcs(name: string, events: IcsEvent[], now = new Date()): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Billanta//Kalendar//CS",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${esc(name)}`,
    "X-WR-TIMEZONE:Europe/Prague",
    "REFRESH-INTERVAL;VALUE=DURATION:PT6H",
    "X-PUBLISHED-TTL:PT6H",
  ];
  for (const e of events) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${e.uid}`,
      `DTSTAMP:${stamp(now)}`,
      `DTSTART;VALUE=DATE:${ymd(e.date)}`,
      `DTEND;VALUE=DATE:${ymd(nextDay(e.date))}`,
      `SUMMARY:${esc(e.summary)}`,
      "TRANSP:TRANSPARENT",
    );
    if (e.description) lines.push(`DESCRIPTION:${esc(e.description)}`);
    if (e.url) lines.push(`URL:${e.url}`);
    if (e.categories?.length) lines.push(`CATEGORIES:${e.categories.map(esc).join(",")}`);
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}
