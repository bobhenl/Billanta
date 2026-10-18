import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { DbService } from "../../db/db.service";
import { importSkCompanies, pgSkCompaniesStore } from "./sk-companies-import";

/**
 * On in production unless SK_COMPANIES_SYNC=off; elsewhere only with
 * SK_COMPANIES_SYNC=on, so a dev backend left running does not pull the
 * ~930 MB snapshot. Without the index everything falls back to live RPO.
 */
export function skCompaniesSyncEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const flag = (env.SK_COMPANIES_SYNC ?? "").trim().toLowerCase();
  if (flag === "off") return false;
  return flag === "on" || env.NODE_ENV === "production";
}

/**
 * Nightly refresh of the local Slovak register copy. RPO writes the daily
 * delta at 03:00 UTC; a run takes a second or two, except after the
 * monthly snapshot (first Saturday), when it reloads ~1 M subjects in a few
 * minutes. The advisory lock in `importSkCompanies` keeps it from
 * overlapping a manual CLI run or a second backend instance.
 */
@Injectable()
export class SkCompaniesCron {
  private readonly logger = new Logger(SkCompaniesCron.name);

  constructor(private readonly dbService: DbService) {}

  @Cron("15 6 * * *", { timeZone: "Europe/Bratislava" })
  async run(): Promise<void> {
    if (!skCompaniesSyncEnabled()) return;
    try {
      const r = await importSkCompanies(pgSkCompaniesStore(this.dbService.sql), { log: (m) => this.logger.log(m) });
      if (r.skipped) return;
      this.logger.log(
        `sk-companies: ${r.init ? `snapshot ${r.init}, ` : ""}${r.dailies.length} delta(s), +${r.upserted} -${r.removed + r.swept}, ${r.rowCount} rows`,
      );
    } catch (err) {
      this.logger.error(`sk-companies import failed: ${(err as Error).message}`);
    }
  }
}
