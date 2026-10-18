import { Body, Controller, Delete, Get, Param, Patch, Post, Req, Res, UseGuards } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { TwoFactorGuard } from "../auth/two-factor.guard";
import type { TenantScopedRequest } from "../tenancy/tenant-context.middleware";
import { BackupDestinationsService } from "./backup-destinations.service";
import { CreateBackupDestinationDto } from "./dto/create-backup-destination.dto";
import { UpdateBackupDestinationDto } from "./dto/update-backup-destination.dto";
import {
  GOOGLE_DRIVE_OAUTH_STATE_PURPOSE,
  GoogleDriveOAuthService,
} from "./google-drive-oauth.service";
import { OwnerOnlyGuard } from "./owner-only.guard";

/**
 * Tenant-owner-managed backup/export destinations — see
 * `drizzle/schema.ts`'s `backup_destinations`/`backup_runs` doc comments and
 * `apps/backend/README.md`'s "Per-tenant backup destinations" section for
 * the full feature description and how it differs from the platform-wide
 * `apps/backup` pg_dump sidecar.
 *
 * Registered on `TenantContextMiddleware.forRoutes(...)` in `app.module.ts`
 * (needs `req.tenantDb`/`req.user.tenantId`/`req.user.role`) — unlike
 * `GoogleDriveCallbackController` (a SEPARATE controller class, deliberately
 * NOT registered there, since Google's redirect back carries no bearer
 * token — see that controller's doc comment).
 */
@ApiTags("backup-destinations")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OwnerOnlyGuard)
@Controller("v1/backup-destinations")
export class BackupDestinationsController {
  constructor(
    private readonly backupDestinationsService: BackupDestinationsService,
    private readonly googleDriveOAuthService: GoogleDriveOAuthService,
    private readonly jwtService: JwtService,
  ) {}

  @Post()
  @UseGuards(TwoFactorGuard)
  @ApiOperation({
    summary: "Create a webhook backup destination",
    description:
      "Only type: 'webhook' is createable here — a Google Drive destination is connected via " +
      "GET .../google-drive/authorize instead. Returns the plaintext signing secret in THIS " +
      "response only, same reveal-once UX as POST /api/v1/api-keys.",
  })
  create(@Req() req: TenantScopedRequest, @Body() dto: CreateBackupDestinationDto) {
    return this.backupDestinationsService.create(req.tenantDb!, req.user!.tenantId, dto);
  }

  @Get()
  @ApiOperation({
    summary: "List backup destinations for the current tenant",
    description: "Never returns the encrypted config blob or any decrypted secret.",
  })
  list(@Req() req: TenantScopedRequest) {
    return this.backupDestinationsService.list(req.tenantDb!);
  }

  /**
   * Redirects the tenant owner's browser to Google's OAuth consent screen
   * for the `drive.file` scope (distinct from NextAuth's own Google
   * sign-in flow — see `GoogleDriveOAuthService`'s doc comment). `state` is
   * a short-lived signed JWT carrying this request's already-resolved
   * `tenantId`, which `GoogleDriveCallbackController.callback` verifies and
   * trusts on the way back — the callback itself has no session/bearer
   * token to resolve a tenant from otherwise.
   *
   * Declared BEFORE the `:id` routes below in this file so Nest's route
   * matching never mistakes the literal `google-drive` segment for an `:id`
   * param — in practice Express/Nest matches literal segments in
   * registration order and `google-drive/authorize` has more path segments
   * than any bare `:id` route ever would, but keeping the literal route
   * first is the conventional, unambiguous way to write this regardless.
   */
  @Get("google-drive/authorize")
  @UseGuards(TwoFactorGuard)
  @ApiOperation({
    summary: "Start the Google Drive OAuth consent flow for backup exports",
    description:
      "Redirects to Google's consent screen requesting the drive.file scope with " +
      "access_type=offline&prompt=consent (to obtain a refresh token for background access), " +
      "reusing this deployment's existing GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET.",
  })
  authorizeGoogleDrive(@Req() req: TenantScopedRequest, @Res() res: Response): void {
    const state = this.jwtService.sign(
      { tenantId: req.user!.tenantId, purpose: GOOGLE_DRIVE_OAUTH_STATE_PURPOSE },
      { expiresIn: "10m" },
    );
    res.redirect(this.googleDriveOAuthService.buildAuthorizeUrl(state));
  }

  @Patch(":id")
  @UseGuards(TwoFactorGuard)
  @ApiOperation({
    summary: "Update a backup destination",
    description: "Patchable fields: schedule, isActive, webhookUrl, googleDriveFolderId.",
  })
  update(
    @Req() req: TenantScopedRequest,
    @Param("id") id: string,
    @Body() dto: UpdateBackupDestinationDto,
  ) {
    return this.backupDestinationsService.update(req.tenantDb!, id, dto);
  }

  @Delete(":id")
  @ApiOperation({ summary: "Delete a backup destination (hard delete, cascades its run history)" })
  remove(@Req() req: TenantScopedRequest, @Param("id") id: string) {
    return this.backupDestinationsService.remove(req.tenantDb!, id);
  }

  @Get(":id/runs")
  @ApiOperation({ summary: "List export run history for a backup destination" })
  listRuns(@Req() req: TenantScopedRequest, @Param("id") id: string) {
    return this.backupDestinationsService.listRuns(req.tenantDb!, id);
  }

  /**
   * `type: "local"` destinations have no upload/webhook delivery step — the
   * generated SQLite file goes straight back as THIS response's body,
   * `Content-Type: application/vnd.sqlite3` +
   * `Content-Disposition: attachment`, so the browser downloads it directly.
   * That's why this uses a plain `@Res() res: Response` (not `passthrough`,
   * same as `authorizeGoogleDrive` above) rather than just `return`ing a
   * value — Nest's default JSON response handling has no notion of "stream
   * this Buffer as a binary file download with these headers", so the raw
   * Express `Response` is used directly, exactly like `authorizeGoogleDrive`
   * already does for its own non-JSON response (a redirect, there; a binary
   * file, here).
   *
   * `webhook`/`google_drive` destinations (or a `local` destination whose
   * export attempt itself failed, so there's no file to send) fall back to
   * the original JSON `backup_runs` row response.
   */
  @Post(":id/run-now")
  @ApiOperation({
    summary: "Trigger an immediate export for this destination",
    description:
      "Runs the same export logic the hourly scheduler uses (ExportService.runDestinationExport) " +
      "right now, regardless of the destination's configured schedule. Always records a " +
      "backup_runs row, whether delivery succeeds or fails. For type: 'local' destinations, on " +
      "success this returns the generated SQLite file directly (application/vnd.sqlite3) instead " +
      "of a JSON body.",
  })
  async runNow(
    @Req() req: TenantScopedRequest,
    @Param("id") id: string,
    @Res() res: Response,
  ): Promise<void> {
    const result = await this.backupDestinationsService.runNow(req.tenantDb!, req.user!.tenantId, id);

    if (result.file) {
      res.set({
        "Content-Type": "application/vnd.sqlite3",
        "Content-Disposition": `attachment; filename="${result.file.filename}"`,
      });
      res.send(result.file.buffer);
      return;
    }

    res.json(result.run);
  }
}
