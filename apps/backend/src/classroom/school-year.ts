/**
 * Class end dates. A class runs to the end of the school year (31 August,
 * end of the day in Prague/Bratislava); one created in July or August is
 * for the coming year. A teacher may pick any date up to 13 months ahead.
 */
export function defaultClassEnd(now: Date): Date {
  const year = now.getUTCMonth() >= 6 ? now.getUTCFullYear() + 1 : now.getUTCFullYear();
  return endOfAugust(year);
}

export function latestClassEnd(now: Date): Date {
  const d = new Date(now);
  d.setUTCMonth(d.getUTCMonth() + 13);
  return d;
}

/** The end date a teacher asked for, if it is allowed: in the future and at most 13 months away. */
export function validClassEnd(requested: Date, now: Date): boolean {
  return requested.getTime() > now.getTime() && requested.getTime() <= latestClassEnd(now).getTime();
}

/** One more school year from the later of now and the current end, for "extend". */
export function nextSchoolYearEnd(currentEnd: Date, now: Date): Date {
  const base = currentEnd.getTime() > now.getTime() ? currentEnd : now;
  return defaultClassEnd(new Date(Date.UTC(base.getUTCFullYear(), 6, 1)));
}

function endOfAugust(year: number): Date {
  // 23:59:59 CEST.
  return new Date(Date.UTC(year, 7, 31, 21, 59, 59));
}
