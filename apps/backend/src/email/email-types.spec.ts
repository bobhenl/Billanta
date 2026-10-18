import { describe, expect, it } from "vitest";
import { mergeNotificationPrefs, notificationPrefsOf } from "../notifications/notification-prefs";
import { mapResendEvent } from "./email-public.controller";
import { emailTypesView, isUnsubscribed, unsubscribePatch } from "./email-types";

describe("e-mail types and unsubscribe", () => {
  it("shows locked types as always on and optional ones with the member's setting", () => {
    const view = emailTypesView(notificationPrefsOf({ events: { invoice_paid: { email: false } }, weeklyDigest: true }));
    const by = Object.fromEntries(view.map((v) => [v.type, v]));
    expect(by.invoice_paid).toMatchObject({ enabled: false, locked: false, category: "notification" });
    expect(by.weekly_digest).toMatchObject({ enabled: true, category: "digest" });
    expect(by.security_alert).toMatchObject({ enabled: true, locked: true, category: "transactional" });
    expect(by.invoice).toMatchObject({ locked: true, group: "customers" });
  });

  it("turns off exactly what the link names", () => {
    const start = notificationPrefsOf({ weeklyDigest: true });
    const one = mergeNotificationPrefs(start, unsubscribePatch("invoice_paid"));
    expect(one.events.invoice_paid.email).toBe(false);
    expect(one.events.invoice_paid.app).toBe(true);
    expect(one.events.draft_ready.email).toBe(true);
    expect(one.weeklyDigest).toBe(true);
    expect(isUnsubscribed(one, "invoice_paid")).toBe(true);
    expect(isUnsubscribed(one, "all")).toBe(false);

    const digest = mergeNotificationPrefs(start, unsubscribePatch("weekly_digest"));
    expect(digest.weeklyDigest).toBe(false);
    expect(digest.events.invoice_paid.email).toBe(true);

    const all = mergeNotificationPrefs(start, unsubscribePatch("all"));
    expect(isUnsubscribed(all, "all")).toBe(true);
    expect(all.quietHours).toEqual(start.quietHours);
  });
});

describe("mapResendEvent", () => {
  it("suppresses hard bounces and complaints, but not soft bounces", () => {
    expect(
      mapResendEvent({ type: "email.bounced", data: { email_id: "m1", to: ["Jana@Example.cz"], bounce: { type: "Permanent", subType: "General", message: "no such user" } } }),
    ).toEqual({ event: "bounced", providerId: "m1", addresses: ["jana@example.cz"], detail: "Permanent: General: no such user" });
    const soft = mapResendEvent({ type: "email.bounced", data: { email_id: "m2", to: ["a@b.cz"], bounce: { type: "Transient", message: "mailbox full" } } });
    expect(soft).toMatchObject({ addresses: [], detail: "soft: Transient: mailbox full" });
    expect(mapResendEvent({ type: "email.complained", data: { email_id: "m3", to: ["a@b.cz"] } })).toMatchObject({ event: "complained", addresses: ["a@b.cz"] });
    expect(mapResendEvent({ type: "email.delivered", data: { email_id: "m4", to: ["a@b.cz"] } })).toMatchObject({ event: "delivered", addresses: [] });
    expect(mapResendEvent({ type: "email.opened", data: {} })).toBeNull();
  });
});
