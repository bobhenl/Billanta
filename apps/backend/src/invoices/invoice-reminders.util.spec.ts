import { describe, expect, it } from "vitest";
import { reminderPrefsOf } from "../tenants/invoice-form-prefs";
import { amountLeftToPay, isDueForReminder } from "./invoice-reminders.util";

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

  it("stops once the tenant's maximum number of reminders was sent", () => {
    const invoice = { status: "issued", dueDate: daysAgo(40), lastReminderSentAt: daysAgo(10), reminderCount: 3 };
    expect(isDueForReminder(invoice, NOW, { intervalDays: 7, max: 3 })).toBe(false);
    expect(isDueForReminder({ ...invoice, reminderCount: 2 }, NOW, { intervalDays: 7, max: 3 })).toBe(true);
  });

  it("uses the tenant's interval instead of the default 7 days", () => {
    const invoice = { status: "issued", dueDate: daysAgo(40), lastReminderSentAt: daysAgo(10) };
    expect(isDueForReminder(invoice, NOW, { intervalDays: 14, max: 5 })).toBe(false);
    expect(isDueForReminder(invoice, NOW, { intervalDays: 3, max: 5 })).toBe(true);
  });

  it("reminds invoices and proformas, never credit notes or quotes", () => {
    const invoice = { status: "issued", dueDate: daysAgo(3), lastReminderSentAt: null };
    expect(isDueForReminder({ ...invoice, documentType: "invoice" }, NOW)).toBe(true);
    expect(isDueForReminder({ ...invoice, documentType: "proforma" }, NOW)).toBe(true);
    expect(isDueForReminder({ ...invoice, documentType: "credit_note" }, NOW)).toBe(false);
    expect(isDueForReminder({ ...invoice, documentType: "quote" }, NOW)).toBe(false);
  });
});

describe("amountLeftToPay", () => {
  it("subtracts partial payments, rounds to cents and never goes below zero", () => {
    expect(amountLeftToPay(2420, "420.00")).toBe(2000);
    expect(amountLeftToPay(100.1, "0.2")).toBe(99.9);
    expect(amountLeftToPay(2420, null)).toBe(2420);
    expect(amountLeftToPay(2420, "2500")).toBe(0);
  });
});

describe("reminderPrefsOf", () => {
  it("falls back to the defaults for missing or invalid values", () => {
    expect(reminderPrefsOf(null)).toEqual({ enabled: true, intervalDays: 7, max: 3 });
    expect(reminderPrefsOf({ remindersEnabled: false, reminderIntervalDays: 0, reminderMax: 4 })).toEqual({
      enabled: false,
      intervalDays: 7,
      max: 4,
    });
  });
});
