import { describe, expect, it } from "vitest";
import { mergeNotificationPrefs, notificationPrefsOf } from "./notification-prefs";

describe("notificationPrefsOf", () => {
  it("defaults: in-app for everything, email only for payments and AI drafts", () => {
    const p = notificationPrefsOf(null);
    expect(p.events.invoice_viewed).toEqual({ app: true, email: false });
    expect(p.events.invoice_paid).toEqual({ app: true, email: true });
    expect(p.events.draft_ready.email).toBe(true);
    expect(p.browserPopups).toBe(true);
  });

  it("ignores junk in stored prefs", () => {
    const p = notificationPrefsOf({ events: { invoice_paid: { app: "yes", email: false } }, browserPopups: 1 });
    expect(p.events.invoice_paid).toEqual({ app: true, email: false });
    expect(p.browserPopups).toBe(true);
  });
});

describe("mergeNotificationPrefs", () => {
  it("changes only the channels in the patch", () => {
    const next = mergeNotificationPrefs(
      { events: { invoice_sent: { app: false } } },
      { events: { invoice_paid: { email: false } }, browser_popups: false },
    );
    expect(next.events.invoice_sent).toEqual({ app: false, email: false });
    expect(next.events.invoice_paid).toEqual({ app: true, email: false });
    expect(next.browserPopups).toBe(false);
  });
});
