import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { NewsletterService } from "./newsletter.service";

/** Deletes sign-ups nobody confirmed, as the confirmation e-mail promises. */
@Injectable()
export class NewsletterCron {
  private readonly logger = new Logger(NewsletterCron.name);

  constructor(private readonly newsletter: NewsletterService) {}

  @Cron("40 3 * * *", { timeZone: "Europe/Prague" })
  async purge() {
    const n = await this.newsletter.purgeUnconfirmed();
    if (n) this.logger.log(`deleted ${n} unconfirmed newsletter sign-ups`);
  }
}
