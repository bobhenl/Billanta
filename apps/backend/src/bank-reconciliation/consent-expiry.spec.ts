import { describe, expect, it } from "vitest";
import {
  NOTICE_LOCALES,
  consentExpiredNotice,
  consentExpiringNotice,
  consentWarningDue,
  noticeLocaleOf,
  type ConsentWarningCandidate,
} from "./consent-expiry";

const NOW = new Date("2026-12-01T07:30:00Z");
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function conn(left: number | null, warned: number | null = null, over: Partial<ConsentWarningCandidate> = {}): ConsentWarningCandidate {
  return {
    provider: "enable_banking",
    status: "active",
    enabled: true,
    consentExpiresAt: left === null ? null : new Date(NOW.getTime() + left),
    consentWarnedDays: warned,
    ...over,
  };
}

/** Runs the daily sweep over `days` days, storing what it sent like the conditional update does. */
function sweep(c: ConsentWarningCandidate, days: number): (7 | 1)[] {
  const sent: (7 | 1)[] = [];
  for (let d = 0; d < days; d++) {
    const at = new Date(NOW.getTime() + d * DAY);
    const due = consentWarningDue(c, at);
    if (due !== null) {
      sent.push(due);
      c = { ...c, consentWarnedDays: due };
    }
  }
  return sent;
}

describe("consentWarningDue", () => {
  it("sends nothing while more than a week is left", () => {
    expect(consentWarningDue(conn(7 * DAY + HOUR), NOW)).toBeNull();
  });

  it("sends the week warning once 7 days or less are left", () => {
    expect(consentWarningDue(conn(7 * DAY), NOW)).toBe(7);
    expect(consentWarningDue(conn(3 * DAY), NOW)).toBe(7);
  });

  it("sends the last-day warning once 24 hours or less are left", () => {
    expect(consentWarningDue(conn(DAY), NOW)).toBe(1);
    expect(consentWarningDue(conn(2 * HOUR), NOW)).toBe(1);
  });

  it("does not repeat the week warning", () => {
    expect(consentWarningDue(conn(5 * DAY, 7), NOW)).toBeNull();
  });

  it("still sends the last-day warning after the week warning", () => {
    expect(consentWarningDue(conn(12 * HOUR, 7), NOW)).toBe(1);
  });

  it("does not repeat the last-day warning", () => {
    expect(consentWarningDue(conn(12 * HOUR, 1), NOW)).toBeNull();
  });

  it("skips the week warning when the consent is first seen on its last day", () => {
    expect(consentWarningDue(conn(5 * HOUR), NOW)).toBe(1);
  });

  it("leaves an expired consent to the expired notice", () => {
    expect(consentWarningDue(conn(0), NOW)).toBeNull();
    expect(consentWarningDue(conn(-HOUR), NOW)).toBeNull();
  });

  it("ignores connections without a consent date", () => {
    expect(consentWarningDue(conn(null), NOW)).toBeNull();
  });

  it("ignores other providers, inactive and switched-off connections", () => {
    expect(consentWarningDue(conn(3 * DAY, null, { provider: "fio" }), NOW)).toBeNull();
    expect(consentWarningDue(conn(3 * DAY, null, { status: "expired" }), NOW)).toBeNull();
    expect(consentWarningDue(conn(3 * DAY, null, { status: "pending" }), NOW)).toBeNull();
    expect(consentWarningDue(conn(3 * DAY, null, { enabled: false }), NOW)).toBeNull();
  });

  it("sends each warning exactly once over a daily sweep", () => {
    // 10 days and 2 hours left at the first run: week warning on day 4, last-day warning on day 10.
    expect(sweep(conn(10 * DAY + 2 * HOUR), 12)).toEqual([7, 1]);
  });

  it("warns again after a renewal clears the state", () => {
    const warned = conn(12 * HOUR, 1);
    expect(consentWarningDue(warned, NOW)).toBeNull();
    // completePsd2 stores the new expiry and sets consentWarnedDays back to null.
    const renewed = conn(90 * DAY, null);
    expect(sweep(renewed, 92)).toEqual([7, 1]);
  });
});

describe("noticeLocaleOf", () => {
  it("uses the company's locale, Czech when unset and English when unknown", () => {
    expect(noticeLocaleOf("sk")).toBe("sk");
    expect(noticeLocaleOf("de-AT")).toBe("de");
    expect(noticeLocaleOf(null)).toBe("cs");
    expect(noticeLocaleOf("")).toBe("cs");
    expect(noticeLocaleOf("ja")).toBe("en");
  });
});

describe("consent notices", () => {
  const account = { bankName: "Fio banka", accountNumber: "CZ6508000000192000145399", consentExpiresAt: new Date("2026-12-04T13:30:00Z") };

  it("names the account and the expiry date in the company's language", () => {
    const cs = consentExpiringNotice("cs", 7, account);
    expect(cs.title).toBe("Přístup k bankovnímu účtu vyprší do týdne");
    expect(cs.body).toContain("Fio banka CZ6508000000192000145399");
    expect(cs.body).toContain("4. 12. 2026");
    expect(cs.link).toBe("/bank");
    expect(consentExpiringNotice("sk", 1, account).title).toBe("Prístup k bankovému účtu vyprší do 24 hodín");
    expect(consentExpiringNotice("en", 1, account).title).toBe("Bank account access expires within 24 hours");
  });

  it("falls back to a generic bank name", () => {
    expect(consentExpiredNotice("cs", { bankName: null, accountNumber: null }).body).toBe("Banka: obnovte napojení, ať se platby dál párují samy.");
    expect(consentExpiredNotice("de", { bankName: null, accountNumber: "DE1" }).body.startsWith("Bank DE1:")).toBe(true);
  });

  it("has distinct texts in every locale", () => {
    for (const l of NOTICE_LOCALES) {
      const week = consentExpiringNotice(l, 7, account);
      const day = consentExpiringNotice(l, 1, account);
      const gone = consentExpiredNotice(l, account);
      expect(new Set([week.title, day.title, gone.title]).size).toBe(3);
      for (const n of [week, day, gone]) {
        expect(n.title).not.toMatch(/—/);
        expect(n.body).not.toMatch(/—/);
      }
      if (l !== "en") expect(week.title).not.toBe(consentExpiringNotice("en", 7, account).title);
    }
  });
});
