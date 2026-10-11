import { z } from "zod";

/**
 * Settings → Notifikace: which events reach a member and how. Stored per
 * member as `tenant_memberships.notification_prefs` (jsonb):
 * `{ events: { invoice_paid: { app: true, email: true }, … }, browserPopups: true }`.
 * "app" = the bell in the header (and a browser popup when allowed).
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
] as const;
export type NotificationEvent = (typeof NOTIFICATION_EVENTS)[number];
export const NOTIFICATION_CHANNELS = ["app", "email"] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

const EMAIL_ON_BY_DEFAULT: ReadonlySet<NotificationEvent> = new Set(["invoice_paid", "draft_ready", "quote_response"]);

export interface NotificationPrefs {
  events: Record<NotificationEvent, Record<NotificationChannel, boolean>>;
  browserPopups: boolean;
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
});
export type NotificationPrefsPatch = z.infer<typeof notificationPrefsSchema>;

/** Stored prefs with defaults filled in (in-app on for everything, email for payments and AI drafts). */
export function notificationPrefsOf(stored: unknown): NotificationPrefs {
  const s = (stored ?? {}) as {
    events?: Record<string, Partial<Record<NotificationChannel, unknown>> | undefined>;
    browserPopups?: unknown;
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
  return { events, browserPopups: typeof s.browserPopups === "boolean" ? s.browserPopups : true };
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
  return base;
}
