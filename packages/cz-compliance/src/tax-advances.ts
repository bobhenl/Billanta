/**
 * OSVČ monthly advances (sociální, zdravotní, paušální daň) with history.
 * The amounts change every January (new minimums) and sometimes mid-year
 * (after the annual overview), so each entry applies from a month on. For a
 * month and a kind, the amount is the one of the latest entry from that month
 * or earlier that sets the kind; an entry that leaves a kind out keeps the
 * earlier amount. 0 is a real amount ("nothing to pay from then").
 */

export const TAX_ADVANCE_KINDS = ['social', 'health', 'flat_tax'] as const;
export type TaxAdvanceKind = (typeof TAX_ADVANCE_KINDS)[number];
export type TaxAdvanceAmounts = Partial<Record<TaxAdvanceKind, number>>;

/** One entry: amounts that apply from `from` ("YYYY-MM") on. */
export interface TaxAdvancePeriod extends TaxAdvanceAmounts {
  from: string;
}

/** "YYYY-MM", month 01–12. */
export const MONTH_KEY_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;
export const isMonthKey = (s: unknown): s is string => typeof s === 'string' && MONTH_KEY_PATTERN.test(s);

/** Upper bound for one monthly amount (same as the dashboard's own amounts). */
export const TAX_ADVANCE_MAX = 10_000_000;

/** "YYYY-MM" of a date (local time). */
export const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

/** `month` moved by `delta` months ("2026-01", -1 → "2025-12"). */
export function addMonths(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  return monthKey(new Date(y!, m! - 1 + delta, 1));
}

const isAmount = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= TAX_ADVANCE_MAX;

/**
 * The stored value as a clean list, oldest first. Accepts the old single-set
 * object (`{ social, health, flat_tax }`, before 0044) as one entry from
 * `legacyFrom`. Bad entries and amounts are dropped; of two entries with the
 * same month the later one wins.
 */
export function normalizeTaxAdvances(raw: unknown, legacyFrom = '2026-01'): TaxAdvancePeriod[] {
  if (raw == null || typeof raw !== 'object') return [];
  const entries: unknown[] = Array.isArray(raw) ? raw : [{ ...(raw as object), from: legacyFrom }];
  const byMonth = new Map<string, TaxAdvancePeriod>();
  for (const e of entries) {
    if (!e || typeof e !== 'object' || !isMonthKey((e as { from?: unknown }).from)) continue;
    const src = e as Record<string, unknown>;
    const entry: TaxAdvancePeriod = { from: src.from as string };
    for (const k of TAX_ADVANCE_KINDS) if (isAmount(src[k])) entry[k] = src[k] as number;
    if (TAX_ADVANCE_KINDS.some((k) => entry[k] !== undefined)) byMonth.set(entry.from, entry);
  }
  return [...byMonth.values()].sort((a, b) => a.from.localeCompare(b.from));
}

/** Amounts in force in `month` ("YYYY-MM"), per kind; a kind no entry sets so far is missing. */
export function advancesFor(list: readonly TaxAdvancePeriod[], month: string): TaxAdvanceAmounts {
  const out: TaxAdvanceAmounts = {};
  const sorted = [...list].sort((a, b) => a.from.localeCompare(b.from));
  for (const entry of sorted) {
    if (entry.from > month) break;
    for (const k of TAX_ADVANCE_KINDS) if (entry[k] != null) out[k] = entry[k];
  }
  return out;
}

/** The entry that started last on or before `month` (the "current" one in Settings), or null. */
export function currentAdvancePeriod(list: readonly TaxAdvancePeriod[], month: string): TaxAdvancePeriod | null {
  let current: TaxAdvancePeriod | null = null;
  for (const entry of list) if (entry.from <= month && (!current || entry.from > current.from)) current = entry;
  return current;
}

/**
 * The month a deadline pays for. Social and health advances are due in the
 * month after the one they cover (20th / 8th), paušální daň by the 20th of the
 * month itself (§ 7a ZDP). So the 20 January social payment still uses
 * December's amount.
 */
export function advanceMonthOf(kind: TaxAdvanceKind, dueDate: Date): string {
  const due = monthKey(dueDate);
  return kind === 'flat_tax' ? due : addMonths(due, -1);
}

/** Amount of `kind` paid on the deadline `dueDate`, or undefined when none is set for that month. */
export function advanceForDeadline(list: readonly TaxAdvancePeriod[], kind: TaxAdvanceKind, dueDate: Date): number | undefined {
  return advancesFor(list, advanceMonthOf(kind, dueDate))[kind];
}

/**
 * Sum of `kind` over the months of `year`, up to and including `lastMonth`
 * when given (e.g. the months already paid). null when no month of the range
 * has an amount set.
 */
export function advanceTotalFor(list: readonly TaxAdvancePeriod[], kind: TaxAdvanceKind, year: number, lastMonth?: string): number | null {
  let total = 0;
  let any = false;
  for (let m = 1; m <= 12; m++) {
    const month = `${year}-${String(m).padStart(2, '0')}`;
    if (lastMonth && month > lastMonth) break;
    const v = advancesFor(list, month)[kind];
    if (v != null) {
      total += v;
      any = true;
    }
  }
  return any ? Math.round(total * 100) / 100 : null;
}

export const isTaxAdvanceKind = (k: string): k is TaxAdvanceKind => (TAX_ADVANCE_KINDS as readonly string[]).includes(k);
