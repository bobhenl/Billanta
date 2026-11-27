import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { sql } from "drizzle-orm";
import * as schema from "../../drizzle/schema";
import { DbService } from "../db/db.service";
import { drizzleTx } from "../db/drizzle-tx";
import { EetService } from "./eet.service";

/**
 * Every 5 minutes: resends EET records that got no answer (§ 20: without
 * delay, within 48 hours). Only companies with such records are visited,
 * found through the SECURITY DEFINER list_eet_pending_tenant_ids() (0123).
 */
@Injectable()
export class EetCron {
  private readonly logger = new Logger(EetCron.name);

  constructor(
    private readonly dbService: DbService,
    private readonly service: EetService,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async run(): Promise<void> {
    const rows = await this.dbService.db.execute<{ tenant_id: string }>(
      sql`SELECT * FROM list_eet_pending_tenant_ids() AS t(tenant_id)`,
    );
    let confirmed = 0;
    for (const { tenant_id: tenantId } of rows) {
      try {
        await this.dbService.sql.begin(async (tx) => {
          await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;
          confirmed += await this.service.sweepTenant(drizzleTx(tx, schema), tenantId);
        });
      } catch (err) {
        this.logger.error(`EET resend failed for tenant ${tenantId}: ${(err as Error).message}`);
      }
    }
    if (confirmed > 0) this.logger.log(`EET resend: ${confirmed} record(s) confirmed`);
  }
}
