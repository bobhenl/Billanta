import { describe, expect, it } from "vitest";
import { isBackupDue } from "./backup-schedule.util";

const NOW = new Date("2026-09-09T12:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;

describe("isBackupDue", () => {
  it("is never due when inactive, regardless of schedule/lastRunAt", () => {
    expect(
      isBackupDue({ isActive: false, schedule: "daily", lastRunAt: null }, NOW),
    ).toBe(false);
    expect(
      isBackupDue(
        { isActive: false, schedule: "weekly", lastRunAt: new Date("2000-01-01") },
        NOW,
      ),
    ).toBe(false);
  });

  it("is never due for a 'manual' schedule, even when never run", () => {
    expect(isBackupDue({ isActive: true, schedule: "manual", lastRunAt: null }, NOW)).toBe(
      false,
    );
  });

  it("is due when active and never run before (lastRunAt null), for daily and weekly", () => {
    expect(isBackupDue({ isActive: true, schedule: "daily", lastRunAt: null }, NOW)).toBe(
      true,
    );
    expect(isBackupDue({ isActive: true, schedule: "weekly", lastRunAt: null }, NOW)).toBe(
      true,
    );
  });

  describe("daily", () => {
    it("is NOT due if run less than 24h ago", () => {
      const lastRunAt = new Date(NOW.getTime() - 23 * 60 * 60 * 1000);
      expect(isBackupDue({ isActive: true, schedule: "daily", lastRunAt }, NOW)).toBe(false);
    });

    it("is due at exactly 24h", () => {
      const lastRunAt = new Date(NOW.getTime() - 24 * 60 * 60 * 1000);
      expect(isBackupDue({ isActive: true, schedule: "daily", lastRunAt }, NOW)).toBe(true);
    });

    it("is due when run more than 24h ago", () => {
      const lastRunAt = new Date(NOW.getTime() - 48 * 60 * 60 * 1000);
      expect(isBackupDue({ isActive: true, schedule: "daily", lastRunAt }, NOW)).toBe(true);
    });
  });

  describe("weekly", () => {
    it("is NOT due if run less than 7 days ago", () => {
      const lastRunAt = new Date(NOW.getTime() - 6 * DAY_MS);
      expect(isBackupDue({ isActive: true, schedule: "weekly", lastRunAt }, NOW)).toBe(false);
    });

    it("is due at exactly 7 days", () => {
      const lastRunAt = new Date(NOW.getTime() - 7 * DAY_MS);
      expect(isBackupDue({ isActive: true, schedule: "weekly", lastRunAt }, NOW)).toBe(true);
    });

    it("is due when run more than 7 days ago", () => {
      const lastRunAt = new Date(NOW.getTime() - 14 * DAY_MS);
      expect(isBackupDue({ isActive: true, schedule: "weekly", lastRunAt }, NOW)).toBe(true);
    });
  });
});
