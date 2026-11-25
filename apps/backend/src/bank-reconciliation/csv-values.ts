/**
 * Cell-level parsing shared by the generic bank CSV parser (`csv-parser.ts`)
 * and the Wise / Revolut / Stripe exports (`fintech-csv.ts`).
 */

export const CURRENCY_PATTERN = /^[A-Z]{3}$/;

export function nullIfEmpty(value: string | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Lower case, no diacritics, single spaces. */
export function normalizeHeader(cell: string): string {
  return cell
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

const ISO_DATE = /^(\d{4})-(\d{1,2})-(\d{1,2})/;
/** D.M.YYYY (also "6. 8. 2026") and DD-MM-YYYY. Slashes are left out on purpose: 01/02/2026 is ambiguous. */
const DAY_FIRST_DATE = /^(\d{1,2})([.-])\s?(\d{1,2})\2\s?(\d{4})/;
/** "15 Jan 2019", "15 January 2019" */
const DAY_MONTH_NAME = /^(\d{1,2})\.?\s+([A-Za-z]{3,})\.?,?\s+(\d{4})/;
/** "Jan 15, 2019" */
const MONTH_NAME_DAY = /^([A-Za-z]{3,})\.?\s+(\d{1,2}),?\s+(\d{4})/;
/** The time part after the date, with an optional zone. */
const TIME_PART = /^[T ]\s*(\d{1,2}):(\d{2})(?::(\d{2})(?:[.,]\d+)?)?\s*(Z|UTC|GMT|[+-]\d{2}(?::?\d{2})?)?/i;
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

const PRAGUE = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Prague",
  year: "numeric",
  month: "numeric",
  day: "numeric",
});

/** The calendar day an instant falls on in Prague, as UTC midnight like every other row date. */
export function pragueDay(instant: Date): Date {
  const parts = Object.fromEntries(PRAGUE.formatToParts(instant).map((p) => [p.type, p.value]));
  return new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day)));
}

/**
 * Parses a bank date into the calendar day at UTC midnight. A timestamp is
 * moved to the day in Europe/Prague when it says it is UTC or carries an
 * offset ("…Z", "+01:00"), or when the caller knows the column is UTC
 * (`utc`, e.g. Stripe's "Created (UTC)"): 23:30 UTC on the 31st is already
 * the 1st in Prague. A timestamp without a zone in a column of unknown zone
 * is taken as local time, so its own date counts.
 */
export function parseDate(raw: string, options: { utc?: boolean } = {}): Date | null {
  let year: number;
  let month: number;
  let day: number;
  let rest: string;
  const iso = ISO_DATE.exec(raw);
  const dayFirst = DAY_FIRST_DATE.exec(raw);
  const dayMonthName = DAY_MONTH_NAME.exec(raw);
  const monthNameDay = MONTH_NAME_DAY.exec(raw);
  if (iso) {
    [year, month, day] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
    rest = raw.slice(iso[0].length);
  } else if (dayFirst) {
    [day, month, year] = [Number(dayFirst[1]), Number(dayFirst[3]), Number(dayFirst[4])];
    rest = raw.slice(dayFirst[0].length);
  } else if (dayMonthName) {
    [day, month, year] = [Number(dayMonthName[1]), monthNumber(dayMonthName[2]), Number(dayMonthName[3])];
    rest = raw.slice(dayMonthName[0].length);
  } else if (monthNameDay) {
    [day, month, year] = [Number(monthNameDay[2]), monthNumber(monthNameDay[1]), Number(monthNameDay[3])];
    rest = raw.slice(monthNameDay[0].length);
  } else {
    return null;
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  // Rejects 31.02. and similar, which Date would silently roll over.
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;

  const time = TIME_PART.exec(rest);
  if (!time) return date;
  const zone = time[4]?.toUpperCase();
  if (!zone && !options.utc) return date;
  const [hours, minutes, seconds] = [Number(time[1]), Number(time[2]), Number(time[3] ?? 0)];
  if (hours > 23 || minutes > 59 || seconds > 59) return null;
  let offsetMinutes = 0;
  if (zone && zone !== "Z" && zone !== "UTC" && zone !== "GMT") {
    const sign = zone.startsWith("-") ? -1 : 1;
    const digits = zone.slice(1).replace(":", "");
    offsetMinutes = sign * (Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2) || 0));
  }
  const instant = Date.UTC(year, month - 1, day, hours, minutes, seconds) - offsetMinutes * 60_000;
  return pragueDay(new Date(instant));
}

function monthNumber(name: string): number {
  return MONTHS.indexOf(name.slice(0, 3).toLowerCase()) + 1;
}

/**
 * Accepts "1500.00", "-450,50", "1 500,00", "1.500,00" and "1,500.00"; a
 * trailing currency code ("1500,00 CZK") is ignored.
 */
export function parseAmount(raw: string): string | null {
  let value = raw.replace(/[\s  ]/g, "").replace(/[A-Za-z]{3}$/, "");
  if (value === "") return null;
  const lastComma = value.lastIndexOf(",");
  const lastDot = value.lastIndexOf(".");
  if (lastComma > lastDot) {
    value = value.replace(/\./g, "").replace(",", ".");
  } else if (lastComma >= 0) {
    value = value.replace(/,/g, "");
  }
  if (!/^[+-]?\d+(\.\d+)?$/.test(value)) return null;
  return Number(value).toFixed(2);
}

/** Exact sum of two 2-decimal strings (cents as integers, no float drift). */
export function addAmounts(a: string, b: string): string {
  return ((toCents(a) + toCents(b)) / 100).toFixed(2);
}

export function negateAmount(a: string): string {
  return (-toCents(a) / 100).toFixed(2);
}

function toCents(a: string): number {
  return Math.round(Number(a) * 100);
}
