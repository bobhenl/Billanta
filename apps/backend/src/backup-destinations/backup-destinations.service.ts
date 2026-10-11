import { randomBytes } from "node:crypto";
import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { and, desc, eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "../../drizzle/schema";
import { DbService } from "../db/db.service";
import { drizzleTx } from "../db/drizzle-tx";
import type { CreateBackupDestinationDto } from "./dto/create-backup-destination.dto";
import type { UpdateBackupDestinationDto } from "./dto/update-backup-destination.dto";
import { encryptSecret } from "./encryption.util";
import { ExportService, type LocalExportResult } from "./export.service";

type TenantDb = PostgresJsDatabase<typeof schema>;

/**
 * Uniform `runNow` return shape regardless of destination type — `file` is
 * always present (`null` for `webhook`/`google_drive`, since neither of
 * those "delivers" anything back over HTTP) so
 * `BackupDestinationsController.runNow` can branch on one field instead of
 * re-deriving the destination's type itself.
 */
export type RunNowResult = LocalExportResult;

/** Columns safe to return to the dashboard — NEVER `configEncrypted` or the decrypted secret. */
const PUBLIC_DESTINATION_COLUMNS = {
  id: schema.backupDestinations.id,
  type: schema.backupDestinations.type,
  schedule: schema.backupDestinations.schedule,
  isActive: schema.backupDestinations.isActive,
  webhookUrl: schema.backupDestinations.webhookUrl,
  googleDriveFolderId: schema.backupDestinations.googleDriveFolderId,
  lastRunAt: schema.backupDestinations.lastRunAt,
  lastRunStatus: schema.backupDestinations.lastRunStatus,
  createdAt: schema.backupDestinations.createdAt,
  updatedAt: schema.backupDestinations.updatedAt,
} as const;

/**
 * Owns `backup_destinations`/`backup_runs` CRUD for the dashboard-facing
 * endpoints. Two call shapes, mirroring `ApiKeysService`'s own split (see
 * its doc comment):
 *
 *   1. Ordinary tenant-management CRUD (`create`/`list`/`update`/`remove`/
 *      `listRuns`/`runNow`) — always called with `req.tenantDb`, already
 *      tenant-scoped by `TenantContextMiddleware` + `OwnerOnlyGuard`.
 *   2. `createOrReplaceGoogleDriveDestination` — called from
 *      `GoogleDriveCallbackController` BEFORE any tenant context exists
 *      (Google's redirect back carries no bearer token), so it goes through
 *      `DbService` directly via the same `sql.begin()` +
 *      `set_config('app.current_tenant_id', ...)` pattern
 *      `ApiKeysService.touchLastUsed` uses for its own pre-resolved-tenant
 *      write.
 */
@Injectable()
export class BackupDestinationsService {
  constructor(
    private readonly config: ConfigService,
    private readonly dbService: DbService,
    private readonly exportService: ExportService,
  ) {}

  /**
   * Creates a `webhook` or `local` destination for real — see
   * `CreateBackupDestinationDto`'s doc comment for why `google_drive` is
   * accepted at the schema level but always rejected here.
   *
   * `webhook`: generates a fresh random webhook secret (same
   * "server-generated, shown once" shape as `ApiKeysService.create`'s API
   * key), encrypts it, and returns the PLAINTEXT secret in this response
   * only — it is never retrievable again after this call, exactly like an
   * API key.
   *
   * `local`: no secret, no `configEncrypted`, no `webhookUrl` — there is
   * nothing to authenticate against (see `backupDestinationTypeEnum`'s doc
   * comment in `drizzle/schema.ts`), so the returned row has no `secret`
   * field at all rather than a meaningless empty one. `dto.schedule` is
   * already guaranteed to be `"manual"` here by
   * `createBackupDestinationSchema`'s `.refine` — nothing further to enforce
   * on the write path.
   */
  async create(tenantDb: TenantDb, tenantId: string, dto: CreateBackupDestinationDto) {
    if (dto.type === "google_drive") {
      throw new BadRequestException(
        "Google Drive destinations are connected via GET /api/v1/backup-destinations/" +
          "google-drive/authorize, not this endpoint — there is no OAuth refresh token to " +
          "accept in a plain JSON body here.",
      );
    }

    if (dto.type === "local") {
      const [row] = await tenantDb
        .insert(schema.backupDestinations)
        .values({
          tenantId,
          type: "local",
          schedule: dto.schedule,
        })
        .returning(PUBLIC_DESTINATION_COLUMNS);

      return row;
    }

    const secret = randomBytes(32).toString("hex");
    const configEncrypted = encryptSecret(secret, this.encryptionKey());

    const [row] = await tenantDb
      .insert(schema.backupDestinations)
      .values({
        tenantId,
        type: "webhook",
        schedule: dto.schedule,
        webhookUrl: dto.webhookUrl,
        configEncrypted,
      })
      .returning(PUBLIC_DESTINATION_COLUMNS);

    return { ...row, secret };
  }

  /** Never selects `configEncrypted` — see `PUBLIC_DESTINATION_COLUMNS`. */
  list(tenantDb: TenantDb) {
    return tenantDb
      .select(PUBLIC_DESTINATION_COLUMNS)
      .from(schema.backupDestinations)
      .orderBy(desc(schema.backupDestinations.createdAt));
  }

  /**
   * `type` isn't part of `UpdateBackupDestinationDto` (see that DTO's doc
   * comment for why), so the "`local` destinations can only use schedule
   * `manual`" rule from `create-backup-destination.dto.ts` can't be a
   * `.refine` on the update schema itself — it's enforced here instead, by
   * looking up the row's existing `type` whenever `schedule` is being
   * changed to something other than `"manual"`.
   */
  async update(tenantDb: TenantDb, id: string, dto: UpdateBackupDestinationDto) {
    if (dto.schedule !== undefined && dto.schedule !== "manual") {
      const [existing] = await tenantDb
        .select({ type: schema.backupDestinations.type })
        .from(schema.backupDestinations)
        .where(eq(schema.backupDestinations.id, id))
        .limit(1);

      if (existing?.type === "local") {
        throw new BadRequestException(
          "type 'local' destinations can only use schedule 'manual' — there is no way to push " +
            "a file to a browser download on a timer, someone must be present to click download",
        );
      }
    }

    const patch: Partial<typeof schema.backupDestinations.$inferInsert> = {
      updatedAt: new Date(),
    };
    if (dto.schedule !== undefined) patch.schedule = dto.schedule;
    if (dto.isActive !== undefined) patch.isActive = dto.isActive;
    if (dto.webhookUrl !== undefined) patch.webhookUrl = dto.webhookUrl;
    if (dto.googleDriveFolderId !== undefined) patch.googleDriveFolderId = dto.googleDriveFolderId;

    const [row] = await tenantDb
      .update(schema.backupDestinations)
      .set(patch)
      .where(eq(schema.backupDestinations.id, id))
      .returning(PUBLIC_DESTINATION_COLUMNS);

    if (!row) {
      throw new NotFoundException("Backup destination not found");
    }
    return row;
  }

  /**
   * Hard delete — unlike `api_keys`' soft-revoke, a backup destination is a
   * connection config, not a financial audit record; there is nothing worth
   * preserving about a deleted destination's row itself. `backup_runs` rows
   * for it are cascade-deleted alongside it (`drizzle/schema.ts`'s
   * `destinationId` FK) — a tenant deleting a destination is explicitly
   * choosing to discard its run history along with it, not something this
   * app needs to retain for compliance the way it does invoices/expenses.
   */
  async remove(tenantDb: TenantDb, id: string) {
    const [row] = await tenantDb
      .delete(schema.backupDestinations)
      .where(eq(schema.backupDestinations.id, id))
      .returning({ id: schema.backupDestinations.id });

    if (!row) {
      throw new NotFoundException("Backup destination not found");
    }
    return row;
  }

  listRuns(tenantDb: TenantDb, destinationId: string) {
    return tenantDb
      .select()
      .from(schema.backupRuns)
      .where(eq(schema.backupRuns.destinationId, destinationId))
      .orderBy(desc(schema.backupRuns.startedAt));
  }

  /**
   * `POST /:id/run-now` — triggers the exact same export logic the hourly
   * scheduler (`BackupExportCron`) uses, for one destination, immediately.
   * Loads the destination through the caller's own RLS-scoped `tenantDb`
   * first (so a request for another tenant's destination id simply finds
   * nothing — `NotFoundException`, never a cross-tenant read), then branches
   * by type:
   *   - `local` -> `ExportService.runLocalDestinationExport`, which
   *     generates the SQLite file and returns it alongside the recorded run
   *     (`BackupDestinationsController.runNow` streams the file back as the
   *     HTTP response instead of returning JSON).
   *   - `webhook`/`google_drive` -> the existing
   *     `ExportService.runDestinationExport`, wrapped in the same
   *     `{ run, file: null }` shape so the controller has one uniform result
   *     to branch on regardless of destination type.
   */
  async runNow(tenantDb: TenantDb, tenantId: string, destinationId: string): Promise<RunNowResult> {
    const [destination] = await tenantDb
      .select()
      .from(schema.backupDestinations)
      .where(eq(schema.backupDestinations.id, destinationId))
      .limit(1);

    if (!destination) {
      throw new NotFoundException("Backup destination not found");
    }

    if (destination.type === "local") {
      return this.exportService.runLocalDestinationExport(tenantDb, tenantId, destination);
    }

    const run = await this.exportService.runDestinationExport(tenantDb, tenantId, destination);
    return { run, file: null };
  }

  /**
   * Pre-tenant-context write — see this class's doc comment. Called only
   * from `GoogleDriveCallbackController` once `state` has been verified and
   * a refresh token has been obtained. Upserts (rather than always
   * inserting) so reconnecting Google Drive after a revoked/expired token
   * replaces the stored refresh token on the existing row instead of
   * creating a second, duplicate `google_drive` destination for the same
   * tenant.
   */
  async createOrReplaceGoogleDriveDestination(tenantId: string, refreshToken: string): Promise<void> {
    const configEncrypted = encryptSecret(refreshToken, this.encryptionKey());

    await this.dbService.sql.begin(async (tx) => {
      await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;
      const db = drizzleTx(tx, schema);

      const [existing] = await db
        .select({ id: schema.backupDestinations.id })
        .from(schema.backupDestinations)
        .where(
          and(
            eq(schema.backupDestinations.tenantId, tenantId),
            eq(schema.backupDestinations.type, "google_drive"),
          ),
        )
        .limit(1);

      if (existing) {
        await db
          .update(schema.backupDestinations)
          .set({ configEncrypted, isActive: true, updatedAt: new Date() })
          .where(eq(schema.backupDestinations.id, existing.id));
      } else {
        await db.insert(schema.backupDestinations).values({
          tenantId,
          type: "google_drive",
          configEncrypted,
        });
      }
    });
  }

  private encryptionKey(): string | undefined {
    return this.config.get<string>("BACKUP_CONFIG_ENCRYPTION_KEY");
  }
}
