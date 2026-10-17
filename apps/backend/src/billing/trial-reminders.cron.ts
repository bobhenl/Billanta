import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { eq, sql } from "drizzle-orm";
import * as schema from "../../drizzle/schema";
import { DbService } from "../db/db.service";
import { drizzleTx } from "../db/drizzle-tx";
import { NotificationsService, type NotificationPayload } from "../notifications/notifications.service";
import { trialReminderMessage } from "./billing-messages";
import { planSummary, trialReminderDue } from "./plan-access";

/**
 * Daily "your trial ends in 3 days / 1 day / has ended" notices. The trial
 * itself needs no job: `planSummary` stops counting it the moment
 * `trial_ends_at` passes. Same cross-tenant pattern as `BankSyncCron`:
 * `list_tenant_ids()`, then one RLS-scoped transaction per tenant.
 *
 * The stage is recorded before the notice goes out, so a failed e-mail is
 * not retried, but a company is never told the same thing twice.
 */
@Injectable()
export class TrialRemindersCron {
  private readonly logger = new Logger(TrialRemindersCron.name);

  constructor(
    private readonly dbService: DbService,
    private readonly notifications: NotificationsService,
  ) {}

  @Cron("0 8 * * *", { timeZone: "Europe/Prague" })
  async run(now = new Date()): Promise<number> {
    const rows = await this.dbService.db.execute<{ tenant_id: string }>(sql`SELECT * FROM list_tenant_ids() AS t(tenant_id)`);
    let sent = 0;
    for (const { tenant_id: tenantId } of rows) {
      try {
        let notice: NotificationPayload | null = null;
        await this.dbService.sql.begin(async (tx) => {
          await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;
          const db = drizzleTx(tx, schema);
          const [t] = await db.select().from(schema.tenants).where(eq(schema.tenants.id, tenantId));
          if (!t?.trialEndsAt) return;
          const summary = planSummary(t, now);
          const stage = trialReminderDue(summary, t.trialRemindedDays, now);
          if (stage === null || !summary.trial) return;
          await db.update(schema.tenants).set({ trialRemindedDays: stage }).where(eq(schema.tenants.id, tenantId));
          notice = trialReminderMessage(t.defaultLocale, summary.trial.plan, summary.trial.daysLeft);
        });
        if (notice) {
          await this.notifications.deliverBilling(tenantId, notice);
          sent += 1;
        }
      } catch (err) {
        this.logger.error(`trial reminder failed for tenant ${tenantId}: ${(err as Error).message}`);
      }
    }
    if (sent > 0) this.logger.log(`trial reminders: ${sent} sent`);
    return sent;
  }
}
