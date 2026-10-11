import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { sql } from "drizzle-orm";
import * as schema from "../../drizzle/schema";
import { DbService } from "../db/db.service";
import { drizzleTx } from "../db/drizzle-tx";
import { CardPaymentsService } from "./card-payments.service";

/**
 * Every 10 minutes: books card payments whose payer closed the tab before
 * returning from Stripe. Same cross-tenant pattern as `BankSyncCron`.
 */
@Injectable()
export class CardPaymentsCron {
  private readonly logger = new Logger(CardPaymentsCron.name);

  constructor(
    private readonly dbService: DbService,
    private readonly service: CardPaymentsService,
  ) {}

  @Cron(CronExpression.EVERY_10_MINUTES)
  async run(): Promise<void> {
    const rows = await this.dbService.db.execute<{ tenant_id: string }>(
      sql`SELECT * FROM list_tenant_ids() AS t(tenant_id)`,
    );
    let paid = 0;
    for (const { tenant_id: tenantId } of rows) {
      try {
        await this.dbService.sql.begin(async (tx) => {
          await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;
          paid += await this.service.sweepTenant(drizzleTx(tx, schema), tenantId);
        });
      } catch (err) {
        this.logger.error(`card payment sweep failed for tenant ${tenantId}: ${(err as Error).message}`);
      }
    }
    if (paid > 0) this.logger.log(`card payment sweep: ${paid} payment(s) booked`);
  }
}
