/**
 * Statutory minimum monthly advances for a self-employed person, offered as
 * a one-click suggestion next to "Očekávané částky" on the dashboard (never
 * filled in on their own) and shown on the public "minimální zálohy" page.
 * There is no official API for these: ČSSZ, the health insurers, Finanční
 * správa and Sociálna poisťovňa publish them once a year (and a mid-year
 * amendment can change them, as in July 2026).
 *
 * Each entry applies from its month; later entries of the same year override
 * earlier ones. Only the requested calendar year is ever used, so a missing
 * year shows no figure rather than a stale one. Add next year's entries when
 * they are announced. (Moved here from apps/frontend/lib so the public pages
 * and the dashboard read one table.)
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

/** The minimums in force on `date` (that calendar year only) and the month they apply from, or null. */
export function minimumsFor(country: string, date = new Date()): { from: string; values: Partial<Record<MinimumKind, number>> } | null {
  const periods = MINIMUMS[country === 'SK' ? 'SK' : 'CZ'];
  const month = date.toISOString().slice(0, 7);
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
