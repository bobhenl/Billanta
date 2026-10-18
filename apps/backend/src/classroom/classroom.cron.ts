import { Injectable, Logger, OnApplicationBootstrap } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { and, eq, gt, isNull, lte } from "drizzle-orm";
import * as schema from "../../drizzle/schema";
import { DbService } from "../db/db.service";
import { EmailService } from "../email/email.service";
import { classroomConfig } from "./classroom-config";
import { dueReminder, endingMail } from "./classroom-mail";

/**
 * Deletes classes 30 days after their end (every 15 minutes, and once at
 * start-up), and mails the owner 30 and 7 days before the end. Classes are
 * global rows, so the pool reads them; the companies go through the
 * definer functions. Logs counts only.
 */
@Injectable()
export class ClassroomCron implements OnApplicationBootstrap {
  private readonly logger = new Logger(ClassroomCron.name);
  private cleaning = false;
  private reminding = false;

  constructor(
    private readonly dbService: DbService,
    private readonly email: EmailService,
  ) {}

  onApplicationBootstrap() {
    void this.cleanup();
  }

  @Cron("*/15 * * * *")
  async cleanup(): Promise<void> {
    if (this.cleaning) return;
    this.cleaning = true;
    let removed = 0;
    let failed = 0;
    try {
      for (;;) {
        const batch = await this.dbService.sql<{ id: string }[]>`SELECT classroom_claim_expired(50, interval '30 minutes') AS id`;
        for (const { id } of batch) {
          try {
            await this.dbService.sql`SELECT classroom_delete_class(${id})`;
            removed++;
          } catch (err) {
            failed++;
            this.logger.error(`classroom cleanup failed: ${(err as Error).message}`);
          }
        }
        if (batch.length < 50) break;
      }
    } catch (err) {
      this.logger.error(`classroom cleanup sweep failed: ${(err as Error).message}`);
    } finally {
      this.cleaning = false;
    }
    if (removed || failed) this.logger.log(`classroom cleanup: ${removed} classes removed, ${failed} failed`);
  }

  @Cron("0 7 * * *", { timeZone: "Europe/Prague" })
  async remind(): Promise<void> {
    if (this.reminding || !classroomConfig().enabled) return;
    this.reminding = true;
    let sent = 0;
    let failed = 0;
    try {
      const now = new Date();
      const rows = await this.dbService.db
        .select({
          id: schema.classroomClasses.id,
          name: schema.classroomClasses.name,
          language: schema.classroomClasses.language,
          endsAt: schema.classroomClasses.endsAt,
          remindedDays: schema.classroomClasses.remindedDays,
          email: schema.users.email,
        })
        .from(schema.classroomClasses)
        .innerJoin(schema.classroomTeachers, eq(schema.classroomTeachers.id, schema.classroomClasses.ownerTeacherId))
        .innerJoin(schema.users, eq(schema.users.id, schema.classroomTeachers.userId))
        .where(
          and(
            gt(schema.classroomClasses.endsAt, now),
            lte(schema.classroomClasses.endsAt, new Date(now.getTime() + 30 * 86_400_000)),
            isNull(schema.classroomClasses.cleanupStartedAt),
          ),
        );
      for (const row of rows) {
        const days = dueReminder(row.endsAt, now, row.remindedDays);
        if (!days) continue;
        try {
          const left = Math.ceil((row.endsAt.getTime() - now.getTime()) / 86_400_000);
          await this.email.sendPlatformEmail({ to: row.email, ...endingMail(row.language, classroomConfig().siteUrl, row.name, row.id, left, row.endsAt) });
          await this.dbService.db.update(schema.classroomClasses).set({ remindedDays: days }).where(eq(schema.classroomClasses.id, row.id));
          sent++;
        } catch (err) {
          failed++;
          this.logger.error(`classroom reminder failed: ${(err as Error).message}`);
        }
      }
    } catch (err) {
      this.logger.error(`classroom reminder sweep failed: ${(err as Error).message}`);
    } finally {
      this.reminding = false;
    }
    if (sent || failed) this.logger.log(`classroom reminders: ${sent} sent, ${failed} failed`);
  }
}
