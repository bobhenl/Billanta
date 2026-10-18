import { describe, expect, it } from "vitest";
import { DEFAULT_QUIET_HOURS } from "../notifications/notification-prefs";
import {
  afterQuietHours,
  classifySendError,
  inQuietWindow,
  isoWeekKey,
  nextStepAfterFailure,
  nonUrgentSendAfter,
  retryDelayMs,
} from "./outbox-policy";

const prague = DEFAULT_QUIET_HOURS; // 21:00–07:00 Europe/Prague
const at = (iso: string) => new Date(iso);

describe("inQuietWindow", () => {
  it("wraps past midnight when start > end", () => {
    expect(inQuietWindow(22 * 60, 21 * 60, 7 * 60)).toBe(true);
    expect(inQuietWindow(3 * 60, 21 * 60, 7 * 60)).toBe(true);
    expect(inQuietWindow(7 * 60, 21 * 60, 7 * 60)).toBe(false);
    expect(inQuietWindow(12 * 60, 21 * 60, 7 * 60)).toBe(false);
  });

  it("handles a same-day window and an empty one", () => {
    expect(inQuietWindow(13 * 60, 12 * 60, 14 * 60)).toBe(true);
    expect(inQuietWindow(15 * 60, 12 * 60, 14 * 60)).toBe(false);
    expect(inQuietWindow(5, 0, 0)).toBe(false);
  });
});

describe("afterQuietHours", () => {
  it("leaves daytime alone", () => {
    const noon = at("2026-10-14T10:00:00Z"); // 12:00 CEST
    expect(afterQuietHours(noon, prague)).toEqual(noon);
  });

  it("moves an evening e-mail to 7:00 Prague the next morning (summer time)", () => {
    expect(afterQuietHours(at("2026-10-14T20:30:00Z"), prague)).toEqual(at("2026-10-15T05:00:00Z"));
  });

  it("moves an early-morning e-mail to 7:00 the same morning (winter time)", () => {
    expect(afterQuietHours(at("2026-12-01T03:15:00Z"), prague)).toEqual(at("2026-12-01T06:00:00Z"));
  });

  it("lands on 7:00 local across the October DST change", () => {
    // 22:00 CEST on Sat 24 Oct; clocks go back overnight, so 7:00 is 06:00Z.
    expect(afterQuietHours(at("2026-10-24T20:00:00Z"), prague)).toEqual(at("2026-10-25T06:00:00Z"));
  });

  it("is off when disabled, and respects another time zone", () => {
    const late = at("2026-10-14T20:30:00Z");
    expect(afterQuietHours(late, { ...prague, enabled: false })).toEqual(late);
    // 20:30Z is 16:30 in New York: not quiet there.
    expect(afterQuietHours(late, { ...prague, timeZone: "America/New_York" })).toEqual(late);
  });
});

describe("nonUrgentSendAfter", () => {
  it("adds the batching window, then skips quiet hours", () => {
    expect(nonUrgentSendAfter(at("2026-10-14T10:00:00Z"), prague, 15)).toEqual(at("2026-10-14T10:15:00Z"));
    // 20:50 CEST + 15 min = 21:05: quiet, so next morning.
    expect(nonUrgentSendAfter(at("2026-10-14T18:50:00Z"), prague, 15)).toEqual(at("2026-10-15T05:00:00Z"));
  });
});

describe("retry policy", () => {
  it("doubles from one minute and caps at six hours", () => {
    const mid = () => 0.5; // no jitter
    expect(retryDelayMs(1, mid)).toBe(60_000);
    expect(retryDelayMs(2, mid)).toBe(120_000);
    expect(retryDelayMs(4, mid)).toBe(480_000);
    expect(retryDelayMs(20, mid)).toBe(6 * 3_600_000);
  });

  it("spreads retries by ±20 %", () => {
    expect(retryDelayMs(1, () => 0)).toBe(48_000);
    expect(retryDelayMs(1, () => 1)).toBe(72_000);
  });

  it("retries rate limits, server and network errors; gives up on rejected requests", () => {
    expect(classifySendError({ statusCode: 429, name: "rate_limit_exceeded" }).retry).toBe(true);
    expect(classifySendError({ statusCode: 503, name: "application_error" }).retry).toBe(true);
    expect(classifySendError({ statusCode: null, name: "network_error" }).retry).toBe(true);
    expect(classifySendError({ statusCode: 422, name: "validation_error", message: "bad to" })).toEqual({
      retry: false,
      reason: "validation_error: bad to",
    });
  });

  it("goes dead after max attempts or a permanent error", () => {
    const now = at("2026-10-14T10:00:00Z");
    const transient = { retry: true, reason: "x" };
    expect(nextStepAfterFailure(2, 6, transient, now, () => 0.5)).toEqual({ outcome: "retry", retryAt: at("2026-10-14T10:02:00Z") });
    expect(nextStepAfterFailure(6, 6, transient, now)).toEqual({ outcome: "dead", retryAt: null });
    expect(nextStepAfterFailure(1, 6, { retry: false, reason: "x" }, now)).toEqual({ outcome: "dead", retryAt: null });
  });
});

describe("isoWeekKey", () => {
  it("uses the Prague calendar date and ISO week numbering", () => {
    expect(isoWeekKey(at("2026-10-12T06:00:00Z"))).toBe("2026-W42"); // Monday 8:00 CEST
    expect(isoWeekKey(at("2027-01-01T12:00:00Z"))).toBe("2026-W53"); // Friday belongs to 2026's last week
    // Sunday 23:30 UTC is already Monday in Prague.
    expect(isoWeekKey(at("2026-10-18T23:30:00Z"))).toBe("2026-W43");
  });
});
