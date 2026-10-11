import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { eq, inArray } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "../../drizzle/schema";
import { decryptSecret } from "./encryption.util";
import { GoogleDriveClient } from "./google-drive.client";
import { SqliteExportService } from "./sqlite-export.service";
import { signWebhookPayload, WEBHOOK_SIGNATURE_HEADER } from "./webhook-signing.util";

type TenantDb = PostgresJsDatabase<typeof schema>;
type BackupDestinationRow = typeof schema.backupDestinations.$inferSelect;
export type BackupRunRow = typeof schema.backupRuns.$inferSelect;

/**
 * Result of {@link ExportService.runLocalDestinationExport} — always carries
 * the recorded `backup_runs` row (success or failed, same "always record"
 * guarantee as {@link ExportService.runDestinationExport}), plus the
 * generated SQLite file when the export succeeded (`null` on failure — there
 * is nothing to send back). `BackupDestinationsController.runNow` uses
 * `file`'s presence to decide whether to stream a file response or fall back
 * to the same JSON run-row response the webhook/google_drive paths return.
 */
export interface LocalExportResult {
  run: BackupRunRow;
  file: { buffer: Buffer; filename: string } | null;
}

export interface ExportBundle {
  exportedAt: string;
  tenant: {
    id: string;
    companyName: string;
    legalName: string;
    ico: string | null;
    dic: string | null;
  };
  invoices: Array<
    typeof schema.invoices.$inferSelect & {
      lineItems: (typeof schema.invoiceLineItems.$inferSelect)[];
    }
  >;
  contacts: (typeof schema.contacts.$inferSelect)[];
  expenses: (typeof schema.expenses.$inferSelect)[];
}

/**
 * Builds and delivers the per-tenant APPLICATION-LEVEL data export
 * (`backup_destinations`/`backup_runs`, `drizzle/schema.ts`) — NOT the
 * platform-wide `apps/backup` pg_dump sidecar. See
 * `apps/backend/README.md`'s "Per-tenant backup destinations" section for
 * the distinction.
 *
 * ============================================================================
 * THE SINGLE MOST IMPORTANT PROPERTY OF THIS FILE: every query below runs
 * through the caller-supplied `TenantDb` — the SAME `req.tenantDb` (or, for
 * the cron path, the same per-tenant `sql.begin()`-scoped instance) every
 * other tenant-facing endpoint in this codebase uses. This class NEVER
 * constructs its own DB connection, never calls `DbService.db` (the shared,
 * tenant-agnostic pool), and never accepts a raw `tenantId` without also
 * requiring the RLS-scoped `TenantDb` bound to that same tenant's
 * transaction. Every `.select()` below is therefore automatically restricted
 * to exactly one tenant's rows by Postgres RLS itself (`tenant_isolation`
 * policy, `drizzle/rls-policies.sql`) — there is no `WHERE tenant_id = ...`
 * to forget, and no way for this code to accidentally read a second
 * tenant's data even if a caller passed the wrong `tenantId` string alongside
 * the right `TenantDb` (RLS would simply return zero rows for a mismatched
 * id, never another tenant's rows, because `app.current_tenant_id` — not the
 * `tenantId` parameter — is what Postgres actually enforces against). This
 * is exactly the same trust boundary `RecurringInvoiceGenerationService`/
 * `InvoiceRemindersRepository` rely on for their own per-tenant transaction
 * blocks — see their doc comments for the general pattern this file reuses,
 * not invents.
 */
@Injectable()
export class ExportService {
  private readonly logger = new Logger(ExportService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly googleDriveClient: GoogleDriveClient,
    private readonly sqliteExportService: SqliteExportService,
  ) {}

  /**
   * Queries exactly one tenant's own data — `invoices` (+ their
   * `invoice_line_items`), `contacts`, `expenses`, plus a handful of
   * identifying `tenants` columns for the bundle header — through the
   * RLS-scoped `db` passed in. See this class's doc comment for why this is
   * safe by construction rather than by convention.
   */
  async buildExportBundle(db: TenantDb, tenantId: string): Promise<ExportBundle> {
    const [tenant] = await db
      .select({
        id: schema.tenants.id,
        companyName: schema.tenants.companyName,
        legalName: schema.tenants.legalName,
        ico: schema.tenants.ico,
        dic: schema.tenants.dic,
      })
      .from(schema.tenants)
      .where(eq(schema.tenants.id, tenantId))
      .limit(1);

    const invoices = await db.select().from(schema.invoices);
    const invoiceIds = invoices.map((invoice) => invoice.id);
    const lineItems = invoiceIds.length
      ? await db
          .select()
          .from(schema.invoiceLineItems)
          .where(inArray(schema.invoiceLineItems.invoiceId, invoiceIds))
      : [];

    const lineItemsByInvoiceId = new Map<string, (typeof schema.invoiceLineItems.$inferSelect)[]>();
    for (const item of lineItems) {
      const bucket = lineItemsByInvoiceId.get(item.invoiceId) ?? [];
      bucket.push(item);
      lineItemsByInvoiceId.set(item.invoiceId, bucket);
    }

    const contacts = await db.select().from(schema.contacts);
    const expenses = await db.select().from(schema.expenses);

    return {
      exportedAt: new Date().toISOString(),
      tenant: tenant ?? { id: tenantId, companyName: "", legalName: "", ico: null, dic: null },
      invoices: invoices.map((invoice) => ({
        ...invoice,
        lineItems: lineItemsByInvoiceId.get(invoice.id) ?? [],
      })),
      contacts,
      expenses,
    };
  }

  /**
   * Runs a full export attempt for one destination — build bundle, deliver
   * it, and record the outcome as a `backup_runs` row and an updated
   * `backup_destinations.last_run_at`/`last_run_status` — ALWAYS, whether
   * delivery succeeded or failed. Failure (a bad webhook URL, an expired/
   * revoked Google refresh token, a network error, ...) is caught here and
   * turned into a `status: "failed"` run row with `error_message` set,
   * never allowed to propagate and silently drop the attempt — see the
   * class-level spec this was built against ("a failed export must still be
   * logged, not silently dropped").
   *
   * `db` must be the RLS-scoped connection for `destination.tenantId` —
   * both call sites (`BackupDestinationsService.runNow`, using
   * `req.tenantDb`; `BackupExportCron`, using its own per-tenant
   * `sql.begin()`-scoped instance) satisfy this the same way every other
   * tenant-scoped write in this codebase does.
   */
  async runDestinationExport(
    db: TenantDb,
    tenantId: string,
    destination: BackupDestinationRow,
  ): Promise<BackupRunRow> {
    const startedAt = new Date();
    let status: "success" | "failed" = "success";
    let errorMessage: string | null = null;
    let recordCount = 0;

    try {
      const bundle = await this.buildExportBundle(db, tenantId);
      recordCount = bundle.invoices.length + bundle.contacts.length + bundle.expenses.length;

      const encryptionKey = this.config.get<string>("BACKUP_CONFIG_ENCRYPTION_KEY");
      const secret = destination.configEncrypted
        ? decryptSecret(destination.configEncrypted, encryptionKey)
        : null;

      if (destination.type === "webhook") {
        if (!destination.webhookUrl) {
          throw new Error("Webhook destination has no webhookUrl configured");
        }
        if (!secret) {
          throw new Error("Webhook destination has no signing secret configured");
        }
        await this.sendToWebhook(destination.webhookUrl, bundle, secret);
      } else if (destination.type === "google_drive") {
        if (!secret) {
          throw new Error(
            "Google Drive destination has no refresh token on file — reconnect via " +
              "GET /api/v1/backup-destinations/google-drive/authorize",
          );
        }
        await this.googleDriveClient.uploadJsonFile(
          secret,
          destination.googleDriveFolderId,
          `faktur-export-${tenantId}-${startedAt.toISOString().replace(/[:.]/g, "-")}.json`,
          JSON.stringify(bundle, null, 2),
        );
      } else {
        // `type === "local"` destinations never reach this method — see
        // `runLocalDestinationExport` (there is no "upload" step for them,
        // just a generated file handed straight back to the HTTP caller).
        // `BackupDestinationsService.runNow` branches before calling this
        // method at all, and `BackupExportCron` never picks a `local` row up
        // in the first place (`isBackupDue` always returns false for
        // `schedule === "manual"`, which is the only schedule a `local` row
        // can ever have). This branch exists purely as a defensive guard
        // against a future call site accidentally routing a `local`
        // destination here instead.
        throw new Error(
          `runDestinationExport does not handle type '${destination.type}' destinations — ` +
            "use runLocalDestinationExport instead",
        );
      }
    } catch (err) {
      status = "failed";
      errorMessage = (err as Error).message;
      this.logger.error(
        `backup export failed for destination ${destination.id} (tenant ${tenantId}): ${errorMessage}`,
      );
    }

    return this.recordRunOutcome(db, tenantId, destination, { startedAt, status, errorMessage, recordCount });
  }

  /**
   * Generates the on-demand SQLite export file for a `type: "local"`
   * destination and records the attempt as a `backup_runs` row — the
   * `local`-specific counterpart to {@link runDestinationExport}. There is no
   * "delivery" step (no webhook to POST to, no Drive folder to upload into):
   * the whole point of a `local` destination is that the generated file goes
   * straight back to the HTTP caller as the response body
   * (`BackupDestinationsController.runNow`), never touching this server's
   * disk longer than the temp file `SqliteExportService.buildSqliteFile`
   * itself creates-and-deletes internally.
   *
   * Same "always record the attempt, success or failure" guarantee as
   * `runDestinationExport` — a failed SQLite build (should be rare; it's
   * pure in-process work, no network call) still produces a `status:
   * "failed"` `backup_runs` row with `error_message` set, and `file: null`
   * so the controller knows to fall back to a JSON error response instead of
   * trying to stream a nonexistent file.
   */
  async runLocalDestinationExport(
    db: TenantDb,
    tenantId: string,
    destination: BackupDestinationRow,
  ): Promise<LocalExportResult> {
    const startedAt = new Date();
    let status: "success" | "failed" = "success";
    let errorMessage: string | null = null;
    let recordCount = 0;
    let file: LocalExportResult["file"] = null;

    try {
      const bundle = await this.buildExportBundle(db, tenantId);
      recordCount = bundle.invoices.length + bundle.contacts.length + bundle.expenses.length;

      const buffer = await this.sqliteExportService.buildSqliteFile(bundle);
      const filename = `faktur-backup-${tenantId}-${startedAt.toISOString().replace(/[:.]/g, "-")}.db`;
      file = { buffer, filename };
    } catch (err) {
      status = "failed";
      errorMessage = (err as Error).message;
      this.logger.error(
        `local backup export failed for destination ${destination.id} (tenant ${tenantId}): ${errorMessage}`,
      );
    }

    const run = await this.recordRunOutcome(db, tenantId, destination, {
      startedAt,
      status,
      errorMessage,
      recordCount,
    });
    return { run, file };
  }

  /**
   * Shared tail of both export paths above: writes the `backup_runs` row and
   * updates `backup_destinations.last_run_at`/`last_run_status` — the exact
   * same bookkeeping regardless of which destination type produced the
   * outcome. Factored out so `runDestinationExport` and
   * `runLocalDestinationExport` can't drift on this "always record, success
   * or failure" guarantee.
   */
  private async recordRunOutcome(
    db: TenantDb,
    tenantId: string,
    destination: BackupDestinationRow,
    outcome: {
      startedAt: Date;
      status: "success" | "failed";
      errorMessage: string | null;
      recordCount: number;
    },
  ): Promise<BackupRunRow> {
    const finishedAt = new Date();

    const [run] = await db
      .insert(schema.backupRuns)
      .values({
        tenantId,
        destinationId: destination.id,
        startedAt: outcome.startedAt,
        finishedAt,
        status: outcome.status,
        errorMessage: outcome.errorMessage,
        recordCount: outcome.recordCount,
      })
      .returning();

    await db
      .update(schema.backupDestinations)
      .set({
        lastRunAt: finishedAt,
        lastRunStatus: outcome.status === "success" ? "success" : (outcome.errorMessage ?? "failed"),
        updatedAt: new Date(),
      })
      .where(eq(schema.backupDestinations.id, destination.id));

    return run;
  }

  /**
   * POSTs the JSON bundle to `webhookUrl`, signed with `X-Faktur-Signature`
   * (`webhook-signing.util.ts`) — the receiving endpoint (owned by the
   * tenant, not this app) verifies that header using the same secret it was
   * shown once at creation time, the same way this app itself verifies
   * Stripe's `Stripe-Signature` on inbound webhooks, just with the roles
   * reversed (this app is the sender here).
   */
  private async sendToWebhook(url: string, bundle: ExportBundle, secret: string): Promise<void> {
    const rawBody = JSON.stringify(bundle);
    const signature = signWebhookPayload(rawBody, secret);

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [WEBHOOK_SIGNATURE_HEADER]: signature,
      },
      body: rawBody,
    });

    if (!response.ok) {
      throw new Error(`Webhook destination responded with HTTP ${response.status}`);
    }
  }
}
