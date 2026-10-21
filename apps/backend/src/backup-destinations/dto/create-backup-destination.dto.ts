import { createZodDto } from "nestjs-zod";
import { z } from "zod";

const hostRe = /^(?=.{1,253}$)[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?$|^\[?[0-9A-Fa-f:.]+\]?$/;

export const sftpTargetSchema = z.object({
  host: z.string().trim().regex(hostRe, "invalid host"),
  port: z.number().int().min(1).max(65535).default(22),
  username: z.string().trim().min(1).max(100),
  // Remote directory, relative to the login directory unless it starts with "/".
  path: z.string().trim().max(500).regex(/^[^\0\r\n]*$/, "invalid path").default("billanta-zalohy"),
  password: z.string().min(1).max(500).optional(),
});

/** none | an age public key | a passphrase (min. 12 characters). */
export const backupEncryptionSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("none") }),
  z.object({ mode: z.literal("key"), recipient: z.string().trim().regex(/^age1[02-9ac-hj-np-z]{58}$/, "invalid age public key") }),
  z.object({ mode: z.literal("passphrase"), passphrase: z.string().min(12).max(500) }),
]);

/**
 * `POST /api/v1/backup-destinations` body.
 *
 * `type: "google_drive"` is accepted here for Swagger/schema completeness
 * (and so a caller gets a clear validation error rather than a confusing
 * "unknown field") but `BackupDestinationsService.create` always rejects it
 * with a 400 pointing at `GET .../google-drive/authorize` instead — there is
 * no OAuth refresh token to accept in a plain JSON body for that flow (see
 * that method's doc comment). `type: "webhook"` and `type: "local"` are both
 * actually createable through this endpoint.
 *
 * `type: "local"` (an on-demand SQLite-file download — see
 * `sqlite-export.service.ts`) is schedule-locked to `"manual"`: the second
 * `.refine` below rejects `daily`/`weekly` for it, because there is no way
 * to "push" a file to a browser download on a timer — a tenant has to
 * actually be present in the dashboard to click download. Note the default
 * schedule is `"weekly"` regardless of `type`, so a `local` creation request
 * that omits `schedule` entirely still fails this refine — the caller must
 * pass `schedule: "manual"` explicitly for `type: "local"`, same as any
 * other request that would otherwise fall outside a type's allowed
 * schedules.
 */
export const createBackupDestinationSchema = z
  .object({
    type: z.enum(["google_drive", "webhook", "local", "sftp"]),
    schedule: z.enum(["daily", "weekly", "manual"]).default("weekly"),
    // Required for webhook destinations (checked below), ignored for
    // google_drive/local.
    webhookUrl: z.string().url().optional(),
    // type = sftp: the company's own server. Without a password the server
    // generates an SSH key and returns its public half to authorize.
    sftp: sftpTargetSchema.optional(),
  })
  .refine((data) => data.type !== "sftp" || Boolean(data.sftp), {
    message: "sftp settings are required when type is 'sftp'",
    path: ["sftp"],
  })
  .refine((data) => data.type !== "webhook" || Boolean(data.webhookUrl), {
    message: "webhookUrl is required when type is 'webhook'",
    path: ["webhookUrl"],
  })
  .refine((data) => data.type !== "local" || data.schedule === "manual", {
    message:
      "type 'local' destinations can only use schedule 'manual' – there is no way to push a " +
      "file to a browser download on a timer, someone must be present to click download",
    path: ["schedule"],
  });

export class CreateBackupDestinationDto extends createZodDto(createBackupDestinationSchema) {}
