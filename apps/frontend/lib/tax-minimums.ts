/**
 * Statutory minimum monthly advances for a self-employed person, offered as
 * a one-click suggestion in Settings → Měsíční zálohy (per period row), never
 * filled in on their own. There is no official API for these: ČSSZ, the
 * health insurers, Finanční správa and Sociálna poisťovňa publish them once
 * a year (and a mid-year amendment can change them, as in July 2026).
 *
 * Each entry applies from its month; later entries of the same year override
 * earlier ones. Only the current calendar year is ever used, so a missing
 * year shows no suggestion rather than a stale figure. Add next year's
 * entries when they are announced.
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

/** The minimums in force on `date` (this calendar year only) and the month they apply from, or null. */
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
