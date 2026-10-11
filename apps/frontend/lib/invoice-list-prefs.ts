/**
 * Invoice list customisation (VoxelRank-style): which quick-filter chips the
 * list shows, and the viewer's saved views. Chip choice lives in a cookie so
 * the server-rendered chips come out right on the first paint; saved views,
 * columns, sorting and inline actions are per-browser conveniences in
 * localStorage (see invoices-table.tsx / invoice-view-bar.tsx).
 */
export const QUICK_COOKIE = 'billanta_inv_quick';

export const TYPE_CHIPS = ['invoice', 'proforma', 'credit_note', 'quote'] as const;
export const STATUS_CHIPS = ['draft', 'issued', 'overdue', 'paid', 'cancelled'] as const;
/** Date-range presets, in the order the "Období" picker lists them. */
export const DATE_PRESETS = [
  'today',
  'yesterday',
  'thisWeek',
  'lastWeek',
  'last7',
  'last30',
  'last90',
  'thisMonth',
  'lastMonth',
  'thisQuarter',
  'lastQuarter',
  'thisYear',
  'lastYear',
  'last12Months'
] as const;
export type DatePreset = (typeof DATE_PRESETS)[number];
/** Extra one-click chips that set a date range or another common filter. */
export const PRESET_CHIPS = [...DATE_PRESETS, 'eur', 'unsent', 'overdue30', 'partial'] as const;
export type PresetChip = (typeof PRESET_CHIPS)[number];

export interface QuickPrefs {
  hiddenTypes: string[];
  hiddenStatuses: string[];
  presets: PresetChip[];
}

export const DEFAULT_QUICK: QuickPrefs = { hiddenTypes: [], hiddenStatuses: [], presets: ['thisMonth', 'lastMonth', 'thisQuarter', 'thisYear', 'last30'] };

export function parseQuickPrefs(raw: string | undefined): QuickPrefs {
  if (!raw) return DEFAULT_QUICK;
  try {
    const v = JSON.parse(decodeURIComponent(raw)) as Partial<QuickPrefs>;
    const list = (x: unknown, allowed: readonly string[]) => (Array.isArray(x) ? x.filter((s): s is string => allowed.includes(s)) : []);
    return {
      hiddenTypes: list(v.hiddenTypes, TYPE_CHIPS),
      hiddenStatuses: list(v.hiddenStatuses, STATUS_CHIPS),
      presets: Array.isArray(v.presets) ? (list(v.presets, PRESET_CHIPS) as PresetChip[]) : DEFAULT_QUICK.presets
    };
  } catch {
    return DEFAULT_QUICK;
  }
}

const pad = (n: number) => String(n).padStart(2, '0');
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** The URL filters a preset chip sets; date presets apply to `dateField`. */
export function presetFilters(preset: PresetChip, now = new Date(), dateField = 'issue'): Record<string, string | undefined> {
  const y = now.getFullYear();
  const m = now.getMonth();
  const d = now.getDate();
  const day = (offset: number) => new Date(y, m, d + offset);
  const range = (from: Date, to: Date) => ({ date_field: dateField, from: iso(from), to: iso(to) });
  // Weeks start on Monday (CZ/SK).
  const monday = day(-((now.getDay() + 6) % 7));
  const q = Math.floor(m / 3) * 3;
  switch (preset) {
    case 'today':
      return range(now, now);
    case 'yesterday':
      return range(day(-1), day(-1));
    case 'thisWeek':
      return range(monday, new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6));
    case 'lastWeek':
      return range(new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() - 7), new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() - 1));
    case 'last7':
      return range(day(-6), now);
    case 'last30':
      return range(day(-29), now);
    case 'last90':
      return range(day(-89), now);
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
    case 'last12Months':
      return range(new Date(y, m - 11, 1), new Date(y, m + 1, 0));
    case 'eur':
      return { currency: 'EUR' };
    case 'unsent':
      return { status: 'issued', sent: 'no' };
    case 'overdue30':
      return { overdue_days: '30' };
    case 'partial':
      return { paid_state: 'partial' };
  }
}

export const isDatePreset = (preset: string): preset is DatePreset => (DATE_PRESETS as readonly string[]).includes(preset);

/** One saved view: the URL query plus how the table looked. */
export interface SavedView {
  id: string;
  name: string;
  query: string;
  columns?: string[];
  sort?: { key: string; dir: 'asc' | 'desc' } | null;
}

export const VIEWS_KEY = 'billanta:invoice-views';
export const COLUMNS_KEY = 'billanta:invoice-columns';
export const SORT_KEY = 'billanta:invoice-sort';
export const INLINE_KEY = 'billanta:invoice-inline-actions';
/** Fired when a saved view is applied, so the table re-reads columns/sort. */
export const VIEW_EVENT = 'billanta:invoice-view';

export function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function writeJson(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage unavailable (private window) — the choice just isn't remembered
  }
}
