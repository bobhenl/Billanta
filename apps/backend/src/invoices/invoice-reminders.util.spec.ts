import { describe, expect, it } from "vitest";
import { isDueForReminder } from "./invoice-reminders.util";

const NOW = new Date("2026-09-09T09:00:00Z");

function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000);
}

function daysFromNow(days: number): Date {
  return new Date(NOW.getTime() + days * 24 * 60 * 60 * 1000);
}

describe("isDueForReminder", () => {
  it("is true for an issued invoice past due that has never been reminded", () => {
    expect(
      isDueForReminder({ status: "issued", dueDate: daysAgo(3), lastReminderSentAt: null }, NOW),
    ).toBe(true);
  });

  it("is true when the last reminder was sent more than 7 days ago", () => {
    expect(
      isDueForReminder(
        { status: "issued", dueDate: daysAgo(20), lastReminderSentAt: daysAgo(8) },
        NOW,
      ),
    ).toBe(true);
  });

  it("is false when the last reminder was sent within the last 7 days (cooldown)", () => {
    expect(
      isDueForReminder(
        { status: "issued", dueDate: daysAgo(20), lastReminderSentAt: daysAgo(3) },
        NOW,
      ),
    ).toBe(false);
  });

  it("is false when the reminder was sent exactly at the 7-day boundary (not yet older than)", () => {
    expect(
      isDueForReminder(
        { status: "issued", dueDate: daysAgo(20), lastReminderSentAt: daysAgo(7) },
        NOW,
      ),
    ).toBe(false);
  });

  it.each(["draft", "pending_review", "paid", "cancelled"] as const)(
    "is false for a non-issued invoice (status=%s), no matter how overdue",
    (status) => {
      expect(isDueForReminder({ status, dueDate: daysAgo(30), lastReminderSentAt: null }, NOW)).toBe(
        false,
      );
    },
  );

  it("is false when the invoice is not yet due (due date in the future)", () => {
    expect(
      isDueForReminder({ status: "issued", dueDate: daysFromNow(1), lastReminderSentAt: null }, NOW),
    ).toBe(false);
  });

  it("is false when due today at the exact current instant (not strictly in the past)", () => {
    expect(
      isDueForReminder({ status: "issued", dueDate: new Date(NOW), lastReminderSentAt: null }, NOW),
    ).toBe(false);
  });

  it("is false when the invoice has no due date at all", () => {
    expect(isDueForReminder({ status: "issued", dueDate: null, lastReminderSentAt: null }, NOW)).toBe(
      false,
    );
  });
});
