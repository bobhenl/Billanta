/**
 * Orthodox Easter Sunday (Meeus' Julian algorithm, moved to the Gregorian
 * calendar). The Julian calendar runs 13 days behind from 1900 to 2099, so
 * the shift is only right in that range; Greece and Cyprus both use it.
 */
export function orthodoxEaster(year: number): Date {
  if (year < 1900 || year > 2099) throw new RangeError(`orthodoxEaster supports 1900-2099, got ${year}`);
  const a = year % 4;
  const b = year % 7;
  const c = year % 19;
  const d = (19 * c + 15) % 30;
  const e = (2 * a + 4 * b - d + 34) % 7;
  const month = Math.floor((d + e + 114) / 31);
  const day = ((d + e + 114) % 31) + 1;
  return new Date(year, month - 1, day + 13);
}

/** ISO dates `offsets` days away from Orthodox Easter Sunday of `year`. */
export function fromOrthodoxEaster(year: number, offsets: readonly number[]): string[] {
  const easter = orthodoxEaster(year);
  return offsets.map((offset) => isoDate(new Date(year, easter.getMonth(), easter.getDate() + offset)));
}

export function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
