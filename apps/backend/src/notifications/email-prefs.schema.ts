import { z } from "zod";
import { notificationPrefsSchema } from "./notification-prefs";

/**
 * `PUT v1/me/notifications/email` (Settings → E-mailová upozornění):
 * `types` maps an e-mail type to on/off (see src/email/email-types.ts);
 * locked types are accepted and ignored.
 */
export const emailPrefsSchema = z.object({
  types: z.record(z.string().max(40), z.boolean()).optional(),
  weekly_digest: z.boolean().optional(),
  quiet_hours: notificationPrefsSchema.shape.quiet_hours,
});
export type EmailPrefsPatch = z.infer<typeof emailPrefsSchema>;
