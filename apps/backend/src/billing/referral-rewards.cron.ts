import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { sql } from "drizzle-orm";
import { DbService } from "../db/db.service";

/**
 * Pays referral rewards held back for a plan paid a year (or more than a
 * month) ahead, once the refund window is over (`release_after`, migration
 * 0079). Monthly plans don't need it: their second payment releases the
 * reward in the webhook. A refund or cancellation in the meantime has
 * already voided the row, so the function skips it.
 */
@Injectable()
export class ReferralRewardsCron {
  private readonly logger = new Logger(ReferralRewardsCron.name);

  constructor(private readonly dbService: DbService) {}

  @Cron("30 8 * * *", { timeZone: "Europe/Prague" })
  async run(): Promise<number> {
    try {
      const rows = await this.dbService.db.execute<{ released: number | null }>(
        sql`SELECT release_due_referral_rewards() AS released`,
      );
      const released = Number(rows[0]?.released ?? 0);
      if (released > 0) this.logger.log(`released ${released} held-back referral rewards`);
      return released;
    } catch (err) {
      this.logger.error(`releasing referral rewards failed: ${(err as Error).message}`);
      return 0;
    }
  }
}
