import type { CountryTaxDeadline } from '../types.js';

const pad = (n: number) => String(n).padStart(2, '0');
const iso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
const weekday = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d)).getUTCDay();

/** Day of the month of the n-th Monday. */
function nthMonday(y: number, m: number, n: number): number {
  const first = weekday(y, m, 1);
  return 1 + ((8 - first) % 7) + (n - 1) * 7;
}

/**
 * The equinox days are fixed each February for the next year by the Cabinet
 * from the National Astronomical Observatory's almanac. Published years come
 * from there; others use the usual approximation, valid 1980–2099.
 */
const EQUINOXES: Readonly<Record<number, readonly [number, number]>> = {
  2026: [20, 23],
  2027: [21, 23],
};

function equinoxes(y: number): readonly [number, number] {
  const published = EQUINOXES[y];
  if (published) return published;
  const k = y - 1980;
  return [
    Math.floor(20.8431 + 0.242194 * k - Math.floor(k / 4)),
    Math.floor(23.2488 + 0.242194 * k - Math.floor(k / 4)),
  ];
}

/**
 * National holidays under the Act on National Holidays (国民の祝日に関する
 * 法律), rules as in force since 2020: art. 2 dates, art. 3(2) substitute
 * holiday when a holiday falls on Sunday, art. 3(3) a day between two
 * holidays is a holiday too. Not valid for 2019–2021, which had one-off moves.
 */
export function jpHolidays(year: number): string[] {
  const [spring, autumn] = equinoxes(year);
  const base = new Set([
    iso(year, 1, 1),
    iso(year, 1, nthMonday(year, 1, 2)),
    iso(year, 2, 11),
    iso(year, 2, 23),
    iso(year, 3, spring),
    iso(year, 4, 29),
    iso(year, 5, 3),
    iso(year, 5, 4),
    iso(year, 5, 5),
    iso(year, 7, nthMonday(year, 7, 3)),
    iso(year, 8, 11),
    iso(year, 9, nthMonday(year, 9, 3)),
    iso(year, 9, autumn),
    iso(year, 10, nthMonday(year, 10, 2)),
    iso(year, 11, 3),
    iso(year, 11, 23),
  ]);

  const all = new Set(base);
  const dayAfter = (d: string, n: number) => {
    const t = new Date(`${d}T00:00:00Z`);
    t.setUTCDate(t.getUTCDate() + n);
    return t.toISOString().slice(0, 10);
  };

  // Citizens' holiday: a weekday sandwiched between two national holidays.
  for (const d of base) {
    const mid = dayAfter(d, 1);
    if (!base.has(mid) && base.has(dayAfter(d, 2)) && new Date(`${mid}T00:00:00Z`).getUTCDay() !== 0) all.add(mid);
  }
  // Substitute holiday: the next day that is not already a holiday.
  for (const d of base) {
    if (new Date(`${d}T00:00:00Z`).getUTCDay() !== 0) continue;
    let next = dayAfter(d, 1);
    while (all.has(next)) next = dayAfter(next, 1);
    all.add(next);
  }
  return [...all].sort();
}

/** General Rules for National Taxes art. 10(2): a deadline on a weekend or holiday moves to the next business day. */
function nextBusinessDay(date: string): string {
  const holidays = new Set(jpHolidays(Number(date.slice(0, 4))));
  let d = date;
  for (;;) {
    const wd = new Date(`${d}T00:00:00Z`).getUTCDay();
    if (wd !== 0 && wd !== 6 && !holidays.has(d)) return d;
    const t = new Date(`${d}T00:00:00Z`);
    t.setUTCDate(t.getUTCDate() + 1);
    d = t.toISOString().slice(0, 10);
  }
}

/**
 * Individuals: income tax return by 15 March (Income Tax Act art. 120),
 * consumption tax return by 31 March (Act on Special Measures concerning
 * Taxation art. 86-4). Corporations with a March year end: corporation and
 * consumption tax returns two months later, 31 May (Corporation Tax Act
 * art. 74, Consumption Tax Act art. 45).
 */
export function jpDeadlines(year: number): CountryTaxDeadline[] {
  return [
    {
      date: nextBusinessDay(iso(year, 3, 15)),
      kind: 'income_tax_individual',
      title: { ja: '所得税の確定申告期限', en: 'Income tax return (individuals)' },
      appliesTo: 'individuals, previous calendar year',
    },
    {
      date: nextBusinessDay(iso(year, 3, 31)),
      kind: 'consumption_tax_individual',
      title: { ja: '消費税の確定申告期限（個人事業者）', en: 'Consumption tax return (sole proprietors)' },
      appliesTo: 'taxable sole proprietors, previous calendar year',
    },
    {
      date: nextBusinessDay(iso(year, 5, 31)),
      kind: 'corporate_tax_march_fy',
      title: { ja: '法人税・消費税の確定申告期限（3月決算）', en: 'Corporation and consumption tax returns (March year end)' },
      appliesTo: 'corporations with a fiscal year ending 31 March',
    },
  ];
}
