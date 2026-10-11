import { createZodDto } from "nestjs-zod";
import { z } from "zod";

/**
 * `PATCH /api/v1/backup-destinations/:id` body — every field optional.
 *
 * `googleDriveFolderId` is included here (not just schedule/isActive/
 * webhookUrl from the original spec list) because the OAuth
 * authorize/callback flow (see `google-drive-oauth.service.ts`) has no place
 * to collect it — Google's consent screen has no notion of "which Drive
 * folder" — so a tenant connects Google Drive first (no folder set, uploads
 * land in the Drive root via `files.create` with no `parents`), then sets a
 * destination folder afterwards through this endpoint if they want one.
 * `type` is deliberately NOT patchable: changing a destination's type after
 * creation would leave `configEncrypted`/`webhookUrl`/`googleDriveFolderId`
 * in an inconsistent state (e.g. a "webhook" row retaining a stale OAuth
 * refresh token) — delete and recreate instead.
 *
 * Because `type` isn't part of this body, the "`local` destinations can only
 * use schedule `manual`" rule from `create-backup-destination.dto.ts` can't
 * be expressed as a `.refine` on this schema alone (there's nothing here to
 * refine against) — `BackupDestinationsService.update` looks up the
 * existing row's `type` itself and rejects `schedule: "daily" | "weekly"`
 * for an existing `local` destination with the same 400 message.
 */
export const updateBackupDestinationSchema = z.object({
  schedule: z.enum(["daily", "weekly", "manual"]).optional(),
  isActive: z.boolean().optional(),
  webhookUrl: z.string().url().optional(),
  googleDriveFolderId: z.string().min(1).optional(),
});

export class UpdateBackupDestinationDto extends createZodDto(updateBackupDestinationSchema) {}
