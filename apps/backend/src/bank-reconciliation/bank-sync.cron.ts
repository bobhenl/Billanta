import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { sql } from "drizzle-orm";
import * as schema from "../../drizzle/schema";
import { loadPlanSummary } from "../billing/plan.guard";
import { planAllows } from "../billing/plan-access";
import { DbService } from "../db/db.service";
import { drizzleTx } from "../db/drizzle-tx";
import { BankConnectionsService } from "./bank-connections.service";

/**
 * Hourly pull of incoming payments for every enabled bank connection. Same
 * cross-tenant pattern as `BackupExportCron`: `list_tenant_ids()` for the
 * ids, then one RLS-scoped transaction per tenant. One request per token per
 * hour stays far below Fio's one-per-30-seconds limit.
 */
@Injectable()
export class BankSyncCron {
  private readonly logger = new Logger(BankSyncCron.name);

  constructor(
    private readonly dbService: DbService,
    private readonly connections: BankConnectionsService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async run(): Promise<void> {
    const rows = await this.dbService.db.execute<{ tenant_id: string }>(
      sql`SELECT * FROM list_tenant_ids() AS t(tenant_id)`,
    );
    let synced = 0;
    for (const { tenant_id: tenantId } of rows) {
      try {
        await this.dbService.sql.begin(async (tx) => {
          await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;
          const db = drizzleTx(tx, schema);
          // A company back on the free plan keeps its connections, they just stop pulling.
          const plan = await loadPlanSummary(db, tenantId);
          if (plan && !planAllows(plan, "bank_sync")) return;
          synced += await this.connections.syncAllForTenant(db, tenantId);
        });
      } catch (err) {
        this.logger.error(`bank sync sweep failed for tenant ${tenantId}: ${(err as Error).message}`);
      }
    }
    if (synced > 0) this.logger.log(`bank sync sweep: ${synced} connection(s) synced`);
  }
}
