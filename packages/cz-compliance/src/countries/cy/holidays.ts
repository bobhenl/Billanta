import { fromOrthodoxEaster } from '../gr/orthodox-easter.js';

/**
 * Cypriot public holidays: the fixed ones plus Green Monday (Easter − 48),
 * Good Friday, Easter Sunday, Monday and Tuesday, and Kataklysmos
 * (Easter + 50), all from Orthodox Easter.
 * Source: Public Holidays Law, list kept by the Press and Information Office
 * (https://www.pio.gov.cy/en/public-holidays.html).
 */
export function cyHolidays(year: number): string[] {
  const fixed = ['01-01', '01-06', '03-25', '04-01', '05-01', '08-15', '10-01', '10-28', '12-25', '12-26'].map(
    (md) => `${year}-${md}`,
  );
  return [...new Set([...fixed, ...fromOrthodoxEaster(year, [-48, -2, 0, 1, 2, 50])])].sort();
}
