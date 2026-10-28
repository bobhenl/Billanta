/**
 * General holidays as gazetted (gov.hk), Sundays excluded. Lunar New Year,
 * Ching Ming, the Buddha's Birthday, Tuen Ng, Mid-Autumn and Chung Yeung
 * follow the Chinese calendar and the substitution rules interact with
 * Easter, so only gazetted years are listed.
 */
const GAZETTED: Readonly<Record<number, readonly string[]>> = {
  2026: [
    '2026-01-01', '2026-02-17', '2026-02-18', '2026-02-19', '2026-04-03', '2026-04-04',
    '2026-04-06', '2026-04-07', '2026-05-01', '2026-05-25', '2026-06-19', '2026-07-01',
    '2026-09-26', '2026-10-01', '2026-10-19', '2026-12-25', '2026-12-26',
  ],
  2027: [
    '2027-01-01', '2027-02-06', '2027-02-08', '2027-02-09', '2027-03-26', '2027-03-27',
    '2027-03-29', '2027-04-05', '2027-05-01', '2027-05-13', '2027-06-09', '2027-07-01',
    '2027-09-16', '2027-10-01', '2027-10-08', '2027-12-25', '2027-12-27',
  ],
};

const pad = (n: number) => String(n).padStart(2, '0');

/** Gregorian Easter Sunday (anonymous Gregorian algorithm). */
function easter(y: number): Date {
  const a = y % 19;
  const b = Math.floor(y / 100);
  const c = y % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(y, month - 1, day));
}

const shift = (d: Date, n: number) => {
  const t = new Date(d);
  t.setUTCDate(t.getUTCDate() + n);
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
};

/** Gazetted list, or for other years the solar and Easter holidays without substitutes. */
export function hkHolidays(year: number): string[] {
  const gazetted = GAZETTED[year];
  if (gazetted) return [...gazetted];
  const e = easter(year);
  return [
    `${year}-01-01`, shift(e, -2), shift(e, -1), shift(e, 1),
    `${year}-05-01`, `${year}-07-01`, `${year}-10-01`, `${year}-12-25`, `${year}-12-26`,
  ].sort();
}
