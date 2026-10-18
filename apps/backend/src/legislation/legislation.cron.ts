import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { LegislationService } from "./legislation.service";

/** Mondays 04:30 Prague time: one request per watched page per week. */
@Injectable()
export class LegislationCron {
  private readonly logger = new Logger(LegislationCron.name);

  constructor(private readonly service: LegislationService) {}

  @Cron("0 30 4 * * 1", { timeZone: "Europe/Prague" })
  async run(): Promise<void> {
    try {
      const results = await this.service.runCheck();
      const flagged = results.filter((r) => r.status === "changed" || r.status === "error").map((r) => `${r.key}=${r.status}`);
      if (flagged.length) this.logger.warn(`legislation check: ${flagged.join(", ")}`);
    } catch (err) {
      this.logger.error(`legislation check failed: ${(err as Error).message}`);
    }
  }
}
