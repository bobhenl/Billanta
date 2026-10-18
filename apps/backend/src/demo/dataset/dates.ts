const DAY = 86_400_000;

/** Midday UTC, so a date never slips to the neighbouring day in CZ/SK time. */
function atNoon(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 10, 0, 0));
}

export function daysAgo(now: Date, n: number): Date {
  return atNoon(new Date(now.getTime() - n * DAY));
}

export function daysFromNow(now: Date, n: number): Date {
  return atNoon(new Date(now.getTime() + n * DAY));
}

export function addDays(d: Date, n: number): Date {
  return atNoon(new Date(d.getTime() + n * DAY));
}

/** `d` shifted by whole hours, for timestamps such as "sent at". */
export function addHours(d: Date, h: number): Date {
  return new Date(d.getTime() + h * 3_600_000);
}
