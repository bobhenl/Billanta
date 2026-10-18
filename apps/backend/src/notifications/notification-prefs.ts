import { z } from "zod";

/**
 * Settings → Notifikace: which events reach a member and how. Stored per
 * member as `tenant_memberships.notification_prefs` (jsonb):
 * `{ events: { invoice_paid: { app: true, email: true }, … }, browserPopups: true,
 *   weeklyDigest: false, quietHours: { enabled: true, start: "21:00", end: "07:00", timeZone: "Europe/Prague" } }`.
 * "app" = the bell in the header (and a browser popup when allowed). The
 * e-mail half of each event, the weekly digest and quiet hours are also
 * edited on Settings → E-mailová upozornění (src/email/email-types.ts).
 */
export const NOTIFICATION_EVENTS = [
  "invoice_paid",
  "invoice_viewed",
  "invoice_overdue",
  "reminder_sent",
  "invoice_sent",
  "draft_ready",
  "bank_import",
  "member_joined",
  "quote_response",
  "buyer_details",
  // A visitor's message from the public profile ("Kontaktovat"). In-app only
  // unless the member opts into e-mail; nothing is ever sent to the visitor.
  "profile_message",
] as const;
export type NotificationEvent = (typeof NOTIFICATION_EVENTS)[number];
export const NOTIFICATION_CHANNELS = ["app", "email"] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

const EMAIL_ON_BY_DEFAULT: ReadonlySet<NotificationEvent> = new Set(["invoice_paid", "draft_ready", "quote_response", "buyer_details"]);

export interface QuietHours {
  enabled: boolean;
  /** "HH:MM", local time in `timeZone`. */
  start: string;
  end: string;
  timeZone: string;
}

export const DEFAULT_QUIET_HOURS: QuietHours = { enabled: true, start: "21:00", end: "07:00", timeZone: "Europe/Prague" };

export interface NotificationPrefs {
  events: Record<NotificationEvent, Record<NotificationChannel, boolean>>;
  browserPopups: boolean;
  /** Monday-morning summary e-mail; opt-in. */
  weeklyDigest: boolean;
  /** Non-urgent e-mail waits until these end. */
  quietHours: QuietHours;
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function quietHoursOf(stored: unknown): QuietHours {
  const q = (stored ?? {}) as Partial<Record<keyof QuietHours, unknown>>;
  return {
    enabled: typeof q.enabled === "boolean" ? q.enabled : DEFAULT_QUIET_HOURS.enabled,
    start: typeof q.start === "string" && HHMM.test(q.start) ? q.start : DEFAULT_QUIET_HOURS.start,
    end: typeof q.end === "string" && HHMM.test(q.end) ? q.end : DEFAULT_QUIET_HOURS.end,
    timeZone: typeof q.timeZone === "string" && isTimeZone(q.timeZone) ? q.timeZone : DEFAULT_QUIET_HOURS.timeZone,
  };
}

const channelSchema = z.object({ app: z.boolean().optional(), email: z.boolean().optional() });
export const notificationPrefsSchema = z.object({
  events: z
    .object(
      Object.fromEntries(NOTIFICATION_EVENTS.map((e) => [e, channelSchema.optional()])) as Record<
        NotificationEvent,
        z.ZodOptional<typeof channelSchema>
      >,
    )
    .optional(),
  browser_popups: z.boolean().optional(),
  weekly_digest: z.boolean().optional(),
  quiet_hours: z
    .object({
      enabled: z.boolean().optional(),
      start: z.string().regex(HHMM).optional(),
      end: z.string().regex(HHMM).optional(),
      time_zone: z.string().max(64).refine(isTimeZone, "invalid_time_zone").optional(),
    })
    .optional(),
});
export type NotificationPrefsPatch = z.infer<typeof notificationPrefsSchema>;

/** Stored prefs with defaults filled in (in-app on for everything, email for payments and AI drafts). */
export function notificationPrefsOf(stored: unknown): NotificationPrefs {
  const s = (stored ?? {}) as {
    events?: Record<string, Partial<Record<NotificationChannel, unknown>> | undefined>;
    browserPopups?: unknown;
    weeklyDigest?: unknown;
    quietHours?: unknown;
  };
  const events = Object.fromEntries(
    NOTIFICATION_EVENTS.map((e) => {
      const c = s.events?.[e] ?? {};
      return [
        e,
        {
          app: typeof c.app === "boolean" ? c.app : true,
          email: typeof c.email === "boolean" ? c.email : EMAIL_ON_BY_DEFAULT.has(e),
        },
      ];
    }),
  ) as NotificationPrefs["events"];
  return {
    events,
    browserPopups: typeof s.browserPopups === "boolean" ? s.browserPopups : true,
    weeklyDigest: typeof s.weeklyDigest === "boolean" ? s.weeklyDigest : false,
    quietHours: quietHoursOf(s.quietHours),
  };
}

export function mergeNotificationPrefs(current: unknown, patch: NotificationPrefsPatch): NotificationPrefs {
  const base = notificationPrefsOf(current);
  for (const e of NOTIFICATION_EVENTS) {
    const p = patch.events?.[e];
    if (!p) continue;
    if (typeof p.app === "boolean") base.events[e].app = p.app;
    if (typeof p.email === "boolean") base.events[e].email = p.email;
  }
  if (typeof patch.browser_popups === "boolean") base.browserPopups = patch.browser_popups;
  if (typeof patch.weekly_digest === "boolean") base.weeklyDigest = patch.weekly_digest;
  const q = patch.quiet_hours;
  if (q) {
    base.quietHours = quietHoursOf({
      enabled: q.enabled ?? base.quietHours.enabled,
      start: q.start ?? base.quietHours.start,
      end: q.end ?? base.quietHours.end,
      timeZone: q.time_zone ?? base.quietHours.timeZone,
    });
  }
  return base;
}
