/** Report periods shared by the dashboard card and the reports page (server and client). */
export const PERIOD_PRESETS = ['thisMonth', 'lastMonth', 'thisQuarter', 'lastQuarter', 'thisYear', 'lastYear', 'last12', 'all'] as const;
export type PeriodPreset = (typeof PERIOD_PRESETS)[number];

const pad = (n: number) => String(n).padStart(2, '0');
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/**
 * [from, to] (inclusive, YYYY-MM-DD) for a preset, relative to today.
 * `all` ("Celkem") runs from `earliest`, the company's first document or
 * expense (`PeriodStats.earliest`), or just today before there is any.
 */
export function presetRange(preset: PeriodPreset, now = new Date(), earliest?: string | null): { from: string; to: string } {
  const y = now.getFullYear();
  const m = now.getMonth();
  const q = Math.floor(m / 3) * 3;
  const range = (from: Date, to: Date) => ({ from: iso(from), to: iso(to) });
  switch (preset) {
    case 'thisMonth':
      return range(new Date(y, m, 1), new Date(y, m + 1, 0));
    case 'lastMonth':
      return range(new Date(y, m - 1, 1), new Date(y, m, 0));
    case 'thisQuarter':
      return range(new Date(y, q, 1), new Date(y, q + 3, 0));
    case 'lastQuarter':
      return range(new Date(y, q - 3, 1), new Date(y, q, 0));
    case 'thisYear':
      return range(new Date(y, 0, 1), new Date(y, 11, 31));
    case 'lastYear':
      return range(new Date(y - 1, 0, 1), new Date(y - 1, 11, 31));
    case 'last12':
      return range(new Date(y, m - 11, 1), new Date(y, m + 1, 0));
    case 'all':
      return { from: earliest && earliest <= iso(now) ? earliest : iso(now), to: iso(now) };
  }
}
