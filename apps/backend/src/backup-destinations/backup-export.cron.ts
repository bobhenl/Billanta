import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { sql } from "drizzle-orm";
import * as schema from "../../drizzle/schema";
import { DbService } from "../db/db.service";
import { drizzleTx } from "../db/drizzle-tx";
import { isBackupDue } from "./backup-schedule.util";
import { ExportService } from "./export.service";

/**
 * Hourly job that scans every tenant's active `backup_destinations` for ones
 * due per their `daily`/`weekly` schedule (`isBackupDue`,
 * `backup-schedule.util.ts`) and runs the export for each — the scheduled
 * counterpart to `BackupDestinationsController.runNow`'s on-demand trigger,
 * sharing the exact same `ExportService.runDestinationExport` so scheduled
 * and manual runs behave identically (same bundle shape, same delivery
 * logic, same `backup_runs` bookkeeping either way).
 *
 * Registered via the `ScheduleModule.forRoot()` already set up once in
 * `AppModule` for `RecurringInvoiceGenerationService` — NOT a second
 * registration (see that module's doc comment).
 *
 * ============================================================================
 * CROSS-TENANT SCAN, REUSING `list_tenant_ids()` — NOT a new SECURITY
 * DEFINER function, per this feature's spec ("reuse the established
 * cross-tenant-scan pattern already used by invoice-reminders.cron.ts and
 * recurring-invoice-generation.service.ts").
 * ============================================================================
 * Same chicken-and-egg shape both of those already solve: this job needs
 * every tenant id before any single `app.current_tenant_id` can be set,
 * because its whole point is to look across every tenant's destinations.
 * `list_tenant_ids()` (`drizzle/rls-policies.sql`) already exists for
 * exactly this "daily/hourly job must scan every tenant" shape — reused
 * here rather than adding a third, overlapping function. Once a tenant id
 * is in hand, everything else (reading that tenant's destinations, running
 * the export, writing `backup_runs`/`backup_destinations` updates) goes
 * through the normal `sql.begin()` + `set_config('app.current_tenant_id',
 * ...)` transaction — RLS is fully enforced per tenant for the actual data
 * access, exactly like `RecurringInvoiceGenerationService.generateForTenant`
 * and `InvoiceRemindersRepository.findOverdueInvoicesForTenant`.
 */
@Injectable()
export class BackupExportCron {
  private readonly logger = new Logger(BackupExportCron.name);

  constructor(
    private readonly dbService: DbService,
    private readonly exportService: ExportService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async run(): Promise<void> {
    const asOf = new Date();
    const tenantIds = await this.listTenantIds();

    let totalRun = 0;
    for (const tenantId of tenantIds) {
      try {
        totalRun += await this.runDueDestinationsForTenant(tenantId, asOf);
      } catch (err) {
        // One tenant's failure (a bad connection, an unexpected error
        // building its bundle) must never abort the whole sweep — every
        // other tenant's due destinations still get their export attempt
        // this hour.
        this.logger.error(
          `backup export sweep failed for tenant ${tenantId}: ${(err as Error).message}`,
          (err as Error).stack,
        );
      }
    }

    this.logger.log(
      `backup export sweep: ${totalRun} destination(s) run across ${tenantIds.length} tenant(s)`,
    );
  }

  private async listTenantIds(): Promise<string[]> {
    const rows = await this.dbService.db.execute<{ tenant_id: string }>(
      sql`SELECT * FROM list_tenant_ids() AS t(tenant_id)`,
    );
    return rows.map((row) => row.tenant_id);
  }

  /**
   * Runs the whole due-destination scan + export for one tenant inside a
   * single `sql.begin()` transaction with `app.current_tenant_id` set —
   * mirrors `RecurringInvoiceGenerationService.generateForTenant` exactly.
   * Returns the number of destinations run (public + directly unit-testable
   * via `isBackupDue` for the pure due-check logic — see
   * `backup-schedule.util.spec.ts` — the same split
   * `RecurringInvoiceGenerationService`/`schedule.spec.ts` uses).
   */
  async runDueDestinationsForTenant(tenantId: string, asOf: Date = new Date()): Promise<number> {
    let run = 0;

    await this.dbService.sql.begin(async (tx) => {
      await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;
      const db = drizzleTx(tx, schema);

      // Small per-tenant row count (a handful of destinations at most), so
      // selecting the full set and filtering in application code costs
      // nothing meaningful — same tradeoff
      // `RecurringInvoiceGenerationService.generateForTenant` makes for
      // `recurring_invoice_templates`.
      const destinations = await db.select().from(schema.backupDestinations);
      const due = destinations.filter((destination) => isBackupDue(destination, asOf));

      for (const destination of due) {
        await this.exportService.runDestinationExport(db, tenantId, destination);
        run++;
      }
    });

    return run;
  }
}
