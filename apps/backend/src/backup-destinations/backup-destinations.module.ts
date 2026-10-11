import { Module } from "@nestjs/common";
import { BackupDestinationsController } from "./backup-destinations.controller";
import { BackupDestinationsService } from "./backup-destinations.service";
import { BackupExportCron } from "./backup-export.cron";
import { ExportService } from "./export.service";
import { GoogleDriveCallbackController } from "./google-drive-callback.controller";
import { GoogleDriveOAuthService } from "./google-drive-oauth.service";
import { GoogleDriveClient } from "./google-drive.client";
import { SftpBackupClient } from "./sftp.client";
import { OwnerOnlyGuard } from "./owner-only.guard";
import { SqliteExportService } from "./sqlite-export.service";

/**
 * Per-tenant backup/export destinations (`src/backup-destinations/`) — see
 * `apps/backend/README.md`'s "Per-tenant backup destinations" section. NOT
 * the platform-wide `apps/backup` pg_dump sidecar.
 *
 * `DbService`/`JwtService` are resolved via the `@Global()`
 * `DbModule`/`JwtModule` (see those modules' doc comments) without needing
 * to import `DbModule`/`AuthModule` here — same as
 * `TenantContextMiddleware`, `ApiKeysService`, and every other consumer of
 * either already does.
 *
 * Two controllers, deliberately NOT one — see
 * `GoogleDriveCallbackController`'s doc comment for why the OAuth callback
 * must be a structurally separate controller class from
 * `BackupDestinationsController` (only the latter is registered on
 * `TenantContextMiddleware.forRoutes(...)` in `app.module.ts`).
 */
@Module({
  controllers: [BackupDestinationsController, GoogleDriveCallbackController],
  providers: [
    BackupDestinationsService,
    ExportService,
    GoogleDriveClient,
    SftpBackupClient,
    GoogleDriveOAuthService,
    OwnerOnlyGuard,
    BackupExportCron,
    SqliteExportService,
  ],
  exports: [BackupDestinationsService],
})
export class BackupDestinationsModule {}
