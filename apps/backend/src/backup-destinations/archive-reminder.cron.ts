import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { eq, sql } from "drizzle-orm";
import * as schema from "../../drizzle/schema";
import { DbService } from "../db/db.service";
import { drizzleTx } from "../db/drizzle-tx";
import { NotificationsService, type NotificationPayload } from "../notifications/notifications.service";
import { archiveReminderDue, archiveReminderMessage, isAutomaticArchive } from "./archive-reminder";
import { DocumentArchiveService } from "./document-archive.service";

/**
 * Once a quarter, owners of companies without an automatic SFTP/Drive archive
 * get a notice to download the document archive. Same cross-tenant pattern and
 * "record first, then deliver" order as `TrialRemindersCron`. Delivery goes
 * through the normal notification prefs, so an owner can switch it off.
 */
@Injectable()
export class ArchiveReminderCron {
  private readonly logger = new Logger(ArchiveReminderCron.name);

  constructor(
    private readonly dbService: DbService,
    private readonly notifications: NotificationsService,
    private readonly documentArchive: DocumentArchiveService,
  ) {}

  @Cron("0 9 * * *", { timeZone: "Europe/Prague" })
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
          if (!t) return;
          const destinations = await db.select().from(schema.backupDestinations);
          const due = archiveReminderDue({
            now,
            remindedAt: t.archiveRemindedAt,
            createdAt: t.createdAt,
            hasAutomaticArchive: destinations.some(isAutomaticArchive),
            // Cheap check first: only quarters that are due pay for the years query.
            hasDocuments: true,
          });
          if (!due || (await this.documentArchive.years(db)).length === 0) return;
          await db.update(schema.tenants).set({ archiveRemindedAt: now }).where(eq(schema.tenants.id, tenantId));
          notice = archiveReminderMessage(t.defaultLocale);
        });
        if (notice) {
          await this.notifications.deliver(tenantId, "archive_reminder", notice, { roles: ["owner"] });
          sent += 1;
        }
      } catch (err) {
        this.logger.error(`archive reminder failed for tenant ${tenantId}: ${(err as Error).message}`);
      }
    }
    if (sent > 0) this.logger.log(`archive reminders: ${sent} sent`);
    return sent;
  }
}
