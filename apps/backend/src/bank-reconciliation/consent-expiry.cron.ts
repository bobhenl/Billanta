import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { sql } from "drizzle-orm";
import * as schema from "../../drizzle/schema";
import { loadPlanSummary } from "../billing/plan.guard";
import { planAllows } from "../billing/plan-access";
import { DbService } from "../db/db.service";
import { drizzleTx } from "../db/drizzle-tx";
import { BankConnectionsService } from "./bank-connections.service";

/**
 * Every morning: warns companies whose PSD2 bank consent runs out within a
 * week or a day (`consentWarningDue`). Same cross-tenant pattern as
 * `BankSyncCron`: `list_tenant_ids()` for the ids, then one RLS-scoped
 * transaction per tenant. 8:30 Prague so the e-mail lands after quiet hours.
 */
@Injectable()
export class ConsentExpiryCron {
  private readonly logger = new Logger(ConsentExpiryCron.name);

  constructor(
    private readonly dbService: DbService,
    private readonly connections: BankConnectionsService,
  ) {}

  @Cron("30 8 * * *", { timeZone: "Europe/Prague" })
  async run(now = new Date()): Promise<number> {
    const rows = await this.dbService.db.execute<{ tenant_id: string }>(sql`SELECT * FROM list_tenant_ids() AS t(tenant_id)`);
    let warned = 0;
    for (const { tenant_id: tenantId } of rows) {
      try {
        await this.dbService.sql.begin(async (tx) => {
          await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;
          const db = drizzleTx(tx, schema);
          // On the free plan the connections don't pull anything, so their consent is nothing to act on yet.
          const plan = await loadPlanSummary(db, tenantId);
          if (plan && !planAllows(plan, "bank_sync")) return;
          warned += await this.connections.warnExpiringConsents(db, tenantId, now);
        });
      } catch (err) {
        this.logger.error(`consent expiry check failed for tenant ${tenantId}: ${(err as Error).message}`);
      }
    }
    if (warned > 0) this.logger.log(`consent expiry: ${warned} warning(s) sent`);
    return warned;
  }
}
