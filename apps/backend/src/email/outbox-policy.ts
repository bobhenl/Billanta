import type { QuietHours } from "../notifications/notification-prefs";

/**
 * Timing rules for the e-mail outbox: when a queued e-mail may go out
 * (batching window, quiet hours) and how a failed send is retried.
 * Overridable per deployment via env.
 */
export const OUTBOX = {
  /** Non-urgent notifications for one member within this window become one e-mail. */
  batchWindowMinutes: envInt("EMAIL_BATCH_WINDOW_MINUTES", 15),
  maxAttempts: envInt("EMAIL_MAX_ATTEMPTS", 6),
  /** Queued mail older than this dies as "expired" instead of going out late. */
  maxAgeHours: envInt("EMAIL_OUTBOX_MAX_AGE_HOURS", 72),
  batchSize: envInt("EMAIL_OUTBOX_BATCH_SIZE", 50),
  lockSeconds: 300,
};

function envInt(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

const minutesOf = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h! * 60 + m!;
};

/** Wall-clock minutes since midnight of `at` in `timeZone`. */
export function localMinutes(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(at);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return get("hour") * 60 + get("minute");
}

/** True when `minute` (0–1439) falls in [start, end), wrapping past midnight when start > end. */
export function inQuietWindow(minute: number, start: number, end: number): boolean {
  if (start === end) return false;
  return start < end ? minute >= start && minute < end : minute >= start || minute < end;
}

/**
 * The earliest moment at or after `at` that is outside the member's quiet
 * hours. The jump is computed from the local clock, then re-checked, so a
 * DST change during the night lands on the first minute after the window
 * rather than an hour off.
 */
export function afterQuietHours(at: Date, quiet: QuietHours | null | undefined): Date {
  if (!quiet?.enabled) return at;
  const start = minutesOf(quiet.start);
  const end = minutesOf(quiet.end);
  let candidate = at;
  for (let i = 0; i < 3; i++) {
    const now = localMinutes(candidate, quiet.timeZone);
    if (!inQuietWindow(now, start, end)) return candidate;
    const wait = (end - now + 1440) % 1440;
    candidate = new Date(Math.floor(candidate.getTime() / 60_000) * 60_000 + wait * 60_000);
  }
  return candidate;
}

/** When a non-urgent e-mail queued at `now` may be sent: after the batching window and outside quiet hours. */
export function nonUrgentSendAfter(now: Date, quiet: QuietHours | null | undefined, windowMinutes = OUTBOX.batchWindowMinutes): Date {
  return afterQuietHours(new Date(now.getTime() + windowMinutes * 60_000), quiet);
}

/**
 * Delay before attempt `attempt + 1` after `attempt` failed: 1 min, 2, 4, 8…
 * capped at 6 hours, with ±`jitter` spread so a provider outage doesn't make
 * every queued e-mail retry in the same second.
 */
export function retryDelayMs(attempt: number, random: () => number = Math.random, jitter = 0.2): number {
  const base = Math.min(60_000 * 2 ** Math.max(attempt - 1, 0), 6 * 60 * 60_000);
  return Math.round(base * (1 - jitter + 2 * jitter * random()));
}

export type SendFailure = { retry: boolean; reason: string };

/**
 * Whether a failed Resend call is worth retrying: rate limits, server errors
 * and network failures are; a rejected request (bad address, unverified
 * domain, invalid attachment) will fail the same way every time.
 */
export function classifySendError(err: { statusCode?: number | null; name?: string; message?: string }): SendFailure {
  const reason = `${err.name ?? "error"}: ${err.message ?? ""}`.slice(0, 500);
  const status = err.statusCode ?? null;
  if (status === null) return { retry: true, reason };
  if (status === 429 || status >= 500) return { retry: true, reason };
  return { retry: false, reason };
}

/** What the worker does with a claimed row after a failed attempt. */
export function nextStepAfterFailure(attempts: number, maxAttempts: number, failure: SendFailure, now = new Date(), random?: () => number) {
  if (!failure.retry || attempts >= maxAttempts) return { outcome: "dead" as const, retryAt: null };
  return { outcome: "retry" as const, retryAt: new Date(now.getTime() + retryDelayMs(attempts, random)) };
}

/** ISO week key ("2026-W42") of `at` in Europe/Prague, for the digest's idempotency key. */
export function isoWeekKey(at: Date, timeZone = "Europe/Prague"): string {
  const ymd = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
  const [y, m, d] = ymd.split("-").map(Number);
  const date = new Date(Date.UTC(y!, m! - 1, d!));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}
