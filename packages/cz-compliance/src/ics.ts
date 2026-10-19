/**
 * Tiny RFC 5545 writer for read-only calendar feeds: all-day events only,
 * which is all the feeds need (tax deadlines, invoice due dates). Shared by
 * the signed-in feed (backend) and the public tax calendar (frontend), so it
 * stays free of Node-only APIs.
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

const esc = (v: string) =>
  v.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

/** UTF-8 length of one code point. */
function octets(ch: string): number {
  const cp = ch.codePointAt(0)!;
  return cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
}

/** Folds a content line to ≤ 75 octets (continuation lines start with a space). */
function fold(line: string): string {
  let total = 0;
  for (const ch of line) total += octets(ch);
  if (total <= 75) return line;
  const parts: string[] = [];
  let cur = '';
  let size = 0;
  for (const ch of line) {
    const n = octets(ch);
    if (size + n > (parts.length ? 74 : 75)) {
      parts.push(cur);
      cur = '';
      size = 0;
    }
    cur += ch;
    size += n;
  }
  parts.push(cur);
  return parts.join('\r\n ');
}

const ymd = (iso: string) => iso.replace(/-/g, '');
function nextDay(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const next = new Date(Date.UTC(y!, m! - 1, d! + 1));
  return next.toISOString().slice(0, 10);
}
const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

export function buildIcs(name: string, events: IcsEvent[], now = new Date()): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Billanta//Kalendar//CS',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${esc(name)}`,
    'X-WR-TIMEZONE:Europe/Prague',
    'REFRESH-INTERVAL;VALUE=DURATION:PT6H',
    'X-PUBLISHED-TTL:PT6H',
  ];
  for (const e of events) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${e.uid}`,
      `DTSTAMP:${stamp(now)}`,
      `DTSTART;VALUE=DATE:${ymd(e.date)}`,
      `DTEND;VALUE=DATE:${ymd(nextDay(e.date))}`,
      `SUMMARY:${esc(e.summary)}`,
      'TRANSP:TRANSPARENT',
    );
    if (e.description) lines.push(`DESCRIPTION:${esc(e.description)}`);
    if (e.url) lines.push(`URL:${e.url}`);
    if (e.categories?.length) lines.push(`CATEGORIES:${e.categories.map(esc).join(',')}`);
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}
