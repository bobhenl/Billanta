import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { FormSchemasService } from "./form-schemas.service";

/** Every morning at 05:15 Prague time: one request per EPO form schema. */
@Injectable()
export class FormSchemasCron {
  private readonly logger = new Logger(FormSchemasCron.name);

  constructor(private readonly service: FormSchemasService) {}

  @Cron("0 15 5 * * *", { timeZone: "Europe/Prague" })
  async run(): Promise<void> {
    try {
      const results = await this.service.runCheck();
      const flagged = results.filter((r) => r.status === "blocked" || r.error).map((r) => `${r.form}=${r.error ?? r.status}`);
      if (flagged.length) this.logger.warn(`form schema check: ${flagged.join(", ")}`);
    } catch (err) {
      this.logger.error(`form schema check failed: ${(err as Error).message}`);
    }
  }
}
