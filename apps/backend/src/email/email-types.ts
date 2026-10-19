import { NOTIFICATION_EVENTS, type NotificationEvent, type NotificationPrefs, type NotificationPrefsPatch } from "../notifications/notification-prefs";

/**
 * Every kind of e-mail Billanta sends, for Settings → E-mailová upozornění
 * and the outbox. `category` decides how the outbox treats it:
 *   - transactional: goes out as soon as possible, no List-Unsubscribe
 *     (security alerts, invitations, the company's own mail to customers);
 *   - notification: activity e-mails a member can turn off; batched per
 *     member and held over quiet hours;
 *   - digest: the opt-in weekly summary; held over quiet hours;
 *   - newsletter: issues to double opt-in subscribers (src/newsletter/),
 *     queued only by enqueue_newsletter_email and claimed after all other mail.
 * Locked rows are shown on the settings page but cannot be switched off.
 */
export type EmailCategory = "transactional" | "notification" | "digest" | "newsletter";
export type EmailTypeGroup = "activity" | "digest" | "account" | "customers";

export interface EmailTypeInfo {
  type: string;
  group: EmailTypeGroup;
  category: EmailCategory;
  locked: boolean;
}

export const LOCKED_EMAIL_TYPES = [
  // To members, always sent.
  { type: "security_alert", group: "account" },
  { type: "billing_notice", group: "account" },
  { type: "team_invitation", group: "account" },
  { type: "password_reset", group: "account" },
  { type: "email_change", group: "account" },
  // The company's own mail to its customers (wording in Settings → E-maily).
  { type: "invoice", group: "customers" },
  { type: "reminder", group: "customers" },
  { type: "buyer_details_request", group: "customers" },
] as const satisfies readonly { type: string; group: EmailTypeGroup }[];

export const EMAIL_TYPES: readonly EmailTypeInfo[] = [
  ...NOTIFICATION_EVENTS.map((type) => ({ type, group: "activity" as const, category: "notification" as const, locked: false })),
  { type: "weekly_digest", group: "digest", category: "digest", locked: false },
  ...LOCKED_EMAIL_TYPES.map((t) => ({ ...t, category: "transactional" as const, locked: true })),
];

/** What a one-click unsubscribe link can switch off; "all" = every optional e-mail. */
export const UNSUBSCRIBE_TYPES = [...NOTIFICATION_EVENTS, "weekly_digest", "all"] as const;
export type UnsubscribeType = (typeof UNSUBSCRIBE_TYPES)[number];

export function isUnsubscribeType(value: string): value is UnsubscribeType {
  return (UNSUBSCRIBE_TYPES as readonly string[]).includes(value);
}

/** The prefs change an unsubscribe link makes. */
export function unsubscribePatch(type: UnsubscribeType): NotificationPrefsPatch {
  const off = (events: readonly NotificationEvent[]) => Object.fromEntries(events.map((e) => [e, { email: false }]));
  if (type === "all") return { events: off(NOTIFICATION_EVENTS), weekly_digest: false };
  if (type === "weekly_digest") return { weekly_digest: false };
  return { events: off([type]) };
}

/** Whether `type` is already off, so the unsubscribe page can say so. */
export function isUnsubscribed(prefs: NotificationPrefs, type: UnsubscribeType): boolean {
  if (type === "weekly_digest") return !prefs.weeklyDigest;
  if (type === "all") return !prefs.weeklyDigest && NOTIFICATION_EVENTS.every((e) => !prefs.events[e].email);
  return !prefs.events[type].email;
}

/** One row per e-mail type with the member's current setting (locked = always on). */
export function emailTypesView(prefs: NotificationPrefs) {
  return EMAIL_TYPES.map((t) => ({
    ...t,
    enabled: t.locked ? true : t.type === "weekly_digest" ? prefs.weeklyDigest : prefs.events[t.type as NotificationEvent].email,
  }));
}
