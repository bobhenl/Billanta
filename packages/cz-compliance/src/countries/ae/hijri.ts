/**
 * Estimated Gregorian dates of the Islamic holidays the Gulf packs need.
 *
 * Hijri months start on an official moon sighting, announced a day or two
 * before, so no algorithm gives the dates for certain. This table holds the
 * dates the authorities and the press published in advance (Umm al-Qura based)
 * and can be off by one day. Years outside the table return nothing; extend it
 * every year. Sources: Gulf News "UAE public holidays 2027"
 * (https://gulfnews.com/living-in-uae/ask-us/uae-public-holidays-2027-1.500638729),
 * Khaleej Times "UAE holidays 2027"
 * (https://www.khaleejtimes.com/uae/uae-holidays-2027-possible-6-day-break-multiple-long-weekends-expected).
 */
export interface HijriEstimate {
  /** 27 Rajab – Isra and Mi'raj (a holiday in OM only). */
  israMiraj: string;
  /** 1 Shawwal. */
  eidAlFitr: string;
  /** 9 Dhu al-Hijjah. */
  arafat: string;
  /** 10 Dhu al-Hijjah. */
  eidAlAdha: string;
  /** 1 Muharram. */
  hijriNewYear: string;
  /** 12 Rabi al-Awwal. */
  mawlid: string;
}

export const HIJRI_ESTIMATES: Readonly<Record<number, HijriEstimate>> = {
  2026: {
    israMiraj: '2026-01-16',
    eidAlFitr: '2026-03-20',
    arafat: '2026-05-26',
    eidAlAdha: '2026-05-27',
    hijriNewYear: '2026-06-16',
    mawlid: '2026-08-25',
  },
  2027: {
    israMiraj: '2027-01-05',
    eidAlFitr: '2027-03-09',
    arafat: '2027-05-15',
    eidAlAdha: '2027-05-16',
    hijriNewYear: '2027-06-06',
    mawlid: '2027-08-14',
  },
};

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** `count` consecutive dates starting at `iso`. */
export function dayRange(iso: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) => addDays(iso, i));
}

/** Sorted, de-duplicated dates of `year` only (a 3-day Eid can spill over New Year). */
export function holidayList(year: number, dates: readonly string[]): string[] {
  return [...new Set(dates)].filter((d) => d.startsWith(`${year}-`)).sort();
}

/** Last day of a month, 1-based month. */
export function lastDayOfMonth(year: number, month: number): string {
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}

export const pad2 = (n: number): string => String(n).padStart(2, '0');

/** Strips spaces, dashes, dots and slashes and upper-cases the rest. */
export const compact = (value: string): string => value.replace(/[\s\-./]/g, '').toUpperCase();
