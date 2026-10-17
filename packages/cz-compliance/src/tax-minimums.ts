/**
 * Statutory minimum monthly advances for a self-employed person, offered as
 * a one-click suggestion per period row in Settings → Měsíční zálohy (never
 * filled in on their own) and shown on the public "minimální zálohy" page.
 * There is no official API for these: ČSSZ, the health insurers, Finanční
 * správa and Sociálna poisťovňa publish them once a year (and a mid-year
 * amendment can change them, as in July 2026).
 *
 * Each entry applies from its month; later entries of the same year override
 * earlier ones. Only the requested calendar year is ever used, so a missing
 * year shows no figure rather than a stale one. Add next year's entries when
 * they are announced. (Moved here from apps/frontend/lib so the public pages
 * and Settings read one table.)
 */
export type MinimumKind = 'health' | 'social' | 'flat_tax';

type Period = { from: string; values: Partial<Record<MinimumKind, number>> };

const MINIMUMS: Record<'CZ' | 'SK', Period[]> = {
  // cssz.gov.cz, vzp.cz, financnisprava.cz (paušální daň 1. pásmo)
  CZ: [
    { from: '2026-01', values: { health: 3306, social: 5720, flat_tax: 9984 } },
    // Novela: the social minimum back to 35 % of the average wage.
    { from: '2026-07', values: { social: 5005, flat_tax: 9162 } }
  ],
  // socpoist.sk, vszp.sk (SZČO bez zdravotného postihnutia)
  SK: [{ from: '2026-01', values: { health: 121.92, social: 303.11 } }]
};

/**
 * Vedlejší činnost (§ 5b odst. 2 zákona č. 589/1992 Sb.): the social minimum
 * base is 11 % of the average wage (2026: 48 967 × 11 % = 5 387 Kč, × 29.2 %
 * = 1 574 Kč a month; cssz.gov.cz). The July 2026 amendment changed only the
 * main-activity share. There is no health minimum for a secondary activity:
 * the minimum base of § 3a zákona č. 592/1992 Sb. applies to the main
 * activity only (vzp.cz).
 */
const SECONDARY_SOCIAL: Period[] = [{ from: '2026-01', values: { social: 1574 } }];

/** Hlavní or vedlejší samostatná výdělečná činnost (Czech OSVČ). */
export type ActivityKind = 'main' | 'secondary';
export const ACTIVITY_KINDS: readonly ActivityKind[] = ['main', 'secondary'];
export const isActivityKind = (v: unknown): v is ActivityKind => v === 'main' || v === 'secondary';

/** The two answers in Settings that decide which advances a Czech OSVČ pays; null = not answered yet. */
export interface AdvanceRegime {
  /** Paušální režim (§ 2a ZDP): the flat tax already contains social and health insurance. */
  flatTax: boolean | null;
  activity: ActivityKind | null;
}

/**
 * What the "Použít" button fills for this regime, or the question to answer
 * first. CZ: in paušální režim only the flat tax (it covers social and
 * health, § 7a ZDP); outside it social and health, for a secondary activity
 * the lower social minimum and no health minimum. SK has no paušální daň
 * here, so it is always social and health. Null when the year (or the
 * secondary minimum for it) is not in the table.
 */
export function applicableMinimums(
  country: string,
  month: string,
  regime: AdvanceRegime
): { from: string; values: Partial<Record<MinimumKind, number>> } | { ask: 'flat_tax' | 'activity' } | null {
  const all = minimumsAt(country, month);
  if (!all) return null;
  if (country === 'SK') return { from: all.from, values: pick(all.values, ['social', 'health']) };
  if (regime.flatTax == null) return { ask: 'flat_tax' };
  if (regime.flatTax) return all.values.flat_tax == null ? null : { from: all.from, values: { flat_tax: all.values.flat_tax } };
  if (regime.activity == null) return { ask: 'activity' };
  if (regime.activity === 'main') return { from: all.from, values: pick(all.values, ['social', 'health']) };
  const year = month.slice(0, 4);
  let found: Period | null = null;
  for (const p of SECONDARY_SOCIAL) if (p.from.startsWith(year) && p.from <= month) found = p;
  return found ? { from: found.from, values: { ...found.values } } : null;
}

function pick(values: Partial<Record<MinimumKind, number>>, kinds: MinimumKind[]): Partial<Record<MinimumKind, number>> {
  const out: Partial<Record<MinimumKind, number>> = {};
  for (const k of kinds) if (values[k] != null) out[k] = values[k];
  return out;
}

/** The minimums in force on `date` (that calendar year only) and the month they apply from, or null. */
export function minimumsFor(country: string, date = new Date()): { from: string; values: Partial<Record<MinimumKind, number>> } | null {
  return minimumsAt(country, date.toISOString().slice(0, 7));
}

/** The minimums in force in `month` ("YYYY-MM", entries of that year only), or null when the year is not known. */
export function minimumsAt(country: string, month: string): { from: string; values: Partial<Record<MinimumKind, number>> } | null {
  const periods = MINIMUMS[country === 'SK' ? 'SK' : 'CZ'];
  const year = month.slice(0, 4);
  const values: Partial<Record<MinimumKind, number>> = {};
  let from: string | null = null;
  for (const p of periods) {
    if (!p.from.startsWith(year) || p.from > month) continue;
    Object.assign(values, p.values);
    from = p.from;
  }
  return from ? { from, values } : null;
}

/** Years the table has entries for, oldest first. */
export function minimumYears(country: string): number[] {
  const periods = MINIMUMS[country === 'SK' ? 'SK' : 'CZ'];
  return [...new Set(periods.map((p) => Number(p.from.slice(0, 4))))].sort((a, b) => a - b);
}

/**
 * The distinct periods of one year: from which month which values apply
 * (later rows carry the earlier values forward). Empty when the year is not
 * in the table.
 */
export function minimumPeriods(country: string, year: number): { from: string; values: Partial<Record<MinimumKind, number>> }[] {
  const out: { from: string; values: Partial<Record<MinimumKind, number>> }[] = [];
  for (const p of MINIMUMS[country === 'SK' ? 'SK' : 'CZ']) {
    if (!p.from.startsWith(String(year))) continue;
    out.push({ from: p.from, values: { ...(out[out.length - 1]?.values ?? {}), ...p.values } });
  }
  return out;
}

/**
 * Month-by-month minimums of one year (index 0 = January), each month with
 * the values in force then; null for months the table has nothing for.
 */
export function minimumsByMonth(country: string, year: number): (Partial<Record<MinimumKind, number>> | null)[] {
  // Mid-month noon UTC, so `toISOString()` in minimumsFor never slips a month.
  return Array.from({ length: 12 }, (_, m) => minimumsFor(country, new Date(Date.UTC(year, m, 15, 12)))?.values ?? null);
}

/**
 * Paušální daň in the 1st band for a whole year: the sum of the monthly
 * amounts in force (the 2026 amendment changed it from July), or null when
 * any month of that year has no figure in the table.
 */
export function flatTaxBand1ForYear(year: number): number | null {
  let sum = 0;
  for (const month of minimumsByMonth('CZ', year)) {
    if (month?.flat_tax == null) return null;
    sum += month.flat_tax;
  }
  return sum;
}

/**
 * Whether the income fits the 1st band of paušální daň (§ 2a ZDP): up to
 * 1 000 000 Kč of any trade income; up to 1 500 000 Kč when (at least 75 % of)
 * it falls under the 80 % or 60 % flat-expense rate; up to 2 000 000 Kč when it
 * falls under the 80 % rate. The calculator asks for one activity type, so
 * "at least 75 %" reduces to "the chosen rate". Other conditions (not a VAT
 * payer, no other income above 50 000 Kč…) are listed next to it in words.
 */
export function fitsFlatTaxBand1(income: number, flatRate: 80 | 60 | 40 | 30 | null): boolean {
  if (income <= 1_000_000) return true;
  if (income <= 1_500_000) return flatRate === 80 || flatRate === 60;
  if (income <= 2_000_000) return flatRate === 80;
  return false;
}
