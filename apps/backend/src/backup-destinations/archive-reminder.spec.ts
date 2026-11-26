import { describe, expect, it } from "vitest";
import { archiveReminderDue, isAutomaticArchive, pragueQuarter } from "./archive-reminder";

const d = (iso: string) => new Date(iso);
const due = (over: Partial<Parameters<typeof archiveReminderDue>[0]> = {}) =>
  archiveReminderDue({
    now: d("2026-04-02T09:00:00Z"),
    remindedAt: null,
    createdAt: d("2025-11-10T10:00:00Z"),
    hasAutomaticArchive: false,
    hasDocuments: true,
    ...over,
  });

describe("archiveReminderDue", () => {
  it("reminds once per quarter", () => {
    expect(due()).toBe(true);
    expect(due({ remindedAt: d("2026-04-01T07:00:00Z") })).toBe(false);
    expect(due({ remindedAt: d("2026-03-31T07:00:00Z") })).toBe(true);
    expect(due({ now: d("2026-06-30T20:00:00Z"), remindedAt: d("2026-04-01T07:00:00Z") })).toBe(false);
  });

  it("waits a full quarter after signup", () => {
    expect(due({ createdAt: d("2026-04-01T08:00:00Z") })).toBe(false);
    expect(due({ createdAt: d("2026-03-31T08:00:00Z") })).toBe(true);
  });

  it("counts quarters in Prague time", () => {
    // 22:30 UTC on 31 Mar is already 1 Apr in Prague (summer time).
    expect(pragueQuarter(d("2026-03-31T22:30:00Z"))).toBe(2026 * 4 + 1);
    expect(pragueQuarter(d("2026-03-31T21:30:00Z"))).toBe(2026 * 4);
    expect(due({ now: d("2026-03-31T22:30:00Z"), remindedAt: d("2026-03-01T10:00:00Z") })).toBe(true);
  });

  it("skips companies with an automatic archive or nothing to archive", () => {
    expect(due({ hasAutomaticArchive: true })).toBe(false);
    expect(due({ hasDocuments: false })).toBe(false);
  });
});

describe("isAutomaticArchive", () => {
  const dest = { type: "sftp", schedule: "daily", isActive: true, archiveDocuments: true };
  it("needs an active scheduled SFTP or Drive destination with the archive on", () => {
    expect(isAutomaticArchive(dest)).toBe(true);
    expect(isAutomaticArchive({ ...dest, type: "google_drive", schedule: "weekly" })).toBe(true);
    expect(isAutomaticArchive({ ...dest, type: "webhook" })).toBe(false);
    expect(isAutomaticArchive({ ...dest, type: "local", schedule: "manual" })).toBe(false);
    expect(isAutomaticArchive({ ...dest, schedule: "manual" })).toBe(false);
    expect(isAutomaticArchive({ ...dest, isActive: false })).toBe(false);
    expect(isAutomaticArchive({ ...dest, archiveDocuments: false })).toBe(false);
  });
});
