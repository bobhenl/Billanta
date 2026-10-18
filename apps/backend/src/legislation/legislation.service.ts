import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { and, desc, eq, isNull } from "drizzle-orm";
import * as schema from "../../drizzle/schema";
import { DbService } from "../db/db.service";
import { compare, datasetDates, LEGISLATION_SOURCES, type LegislationSource } from "./sources";

type SourceRow = typeof schema.legislationSources.$inferSelect;

const HOUR_MS = 3600 * 1000;
/** The weekly cron skips nothing it is due for, even if last week's run started late. */
export const WEEKLY_MIN_AGE_MS = 7 * 24 * HOUR_MS - HOUR_MS;
/** A manual run never refetches a page checked within the last day. */
export const MANUAL_CHECK_MIN_AGE_MS = 24 * HOUR_MS;
const FETCH_TIMEOUT_MS = 15_000;
// Identifies us to the offices' web admins, with a way to reach us.
const USER_AGENT = "BillantaLegislationMonitor/1.0 (+https://billanta.cz; weekly check of published tax forms)";

/**
 * Watches the official pages the tax constants come from (EPO form list,
 * ČSSZ, Finanční správa). Platform-level: global tables only, no tenant.
 * A changed page does not change any constant; it raises an alert so a
 * human re-checks the values and the generators.
 */
@Injectable()
export class LegislationService {
  private readonly logger = new Logger(LegislationService.name);

  constructor(private readonly dbService: DbService) {}

  async runCheck(minAgeMs = WEEKLY_MIN_AGE_MS): Promise<{ key: string; status: string }[]> {
    const rows = await this.dbService.db.select().from(schema.legislationSources);
    const byKey = new Map(rows.map((r) => [r.key, r]));
    const now = new Date();
    const results: { key: string; status: string }[] = [];
    // Sequential on purpose: two of the sources share a host.
    for (const source of LEGISLATION_SOURCES) {
      const row = byKey.get(source.key) ?? null;
      if (row?.lastCheckedAt && now.getTime() - row.lastCheckedAt.getTime() < minAgeMs) {
        results.push({ key: source.key, status: "skipped" });
        continue;
      }
      results.push({ key: source.key, status: await this.checkOne(source, row, now) });
    }
    return results;
  }

  private async checkOne(source: LegislationSource, row: SourceRow | null, now: Date): Promise<string> {
    let html: string;
    try {
      const res = await fetch(source.url, {
        headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        redirect: "follow",
      });
      if (!res.ok) throw new Error(`http_${res.status}`);
      html = await res.text();
    } catch (err) {
      const e = err as Error;
      return this.recordError(source, row, now, e.name === "TimeoutError" ? "timeout" : e.message);
    }

    const outcome = compare(source, html, row?.hash ?? null);
    if (outcome.status === "error") return this.recordError(source, row, now, outcome.error);

    const base = { key: source.key, url: source.url, hash: outcome.hash, excerpt: outcome.excerpt, lastError: null, lastCheckedAt: now };
    if (outcome.status === "changed") {
      // The confirmation date stays where it was until someone reviews the change.
      await this.upsert({ ...base, status: "changed", lastChangedAt: now, confirmedAt: row?.confirmedAt ?? null });
      await this.alert(
        source,
        "legislation_changed",
        `${source.label} changed (${source.url}). Review the constants of: ${source.datasets.join(", ")}.`,
      );
      this.logger.warn(`legislation source changed: ${source.key}`);
      return "changed";
    }
    // A source flagged as changed stays flagged until acknowledged, even
    // though its new content is already the stored baseline.
    const stillFlagged = row?.status === "changed";
    await this.upsert({
      ...base,
      status: stillFlagged ? "changed" : "ok",
      lastChangedAt: row?.lastChangedAt ?? null,
      confirmedAt: stillFlagged ? (row?.confirmedAt ?? null) : now,
    });
    return outcome.status;
  }

  private async recordError(source: LegislationSource, row: SourceRow | null, now: Date, error: string): Promise<string> {
    await this.upsert({
      key: source.key,
      url: source.url,
      hash: row?.hash ?? null,
      excerpt: row?.excerpt ?? null,
      status: "error",
      lastError: error.slice(0, 500),
      lastCheckedAt: now,
      lastChangedAt: row?.lastChangedAt ?? null,
      confirmedAt: row?.confirmedAt ?? null,
    });
    // One alert per failing streak, not one every week.
    if (row?.status !== "error") {
      await this.alert(
        source,
        "legislation_check_failed",
        `${source.label} could not be checked (${error}). The page may have moved or changed shape: ${source.url}`,
      );
    }
    this.logger.warn(`legislation source check failed: ${source.key}: ${error}`);
    return "error";
  }

  private async upsert(values: typeof schema.legislationSources.$inferInsert) {
    const { key: _key, ...rest } = values;
    await this.dbService.db.insert(schema.legislationSources).values(values).onConflictDoUpdate({ target: schema.legislationSources.key, set: rest });
  }

  private async alert(source: LegislationSource, kind: string, message: string) {
    await this.dbService.db.insert(schema.platformAlerts).values({ kind, sourceKey: source.key, message });
  }

  async overview() {
    const db = this.dbService.db;
    const [rows, alerts] = await Promise.all([
      db.select().from(schema.legislationSources),
      db
        .select()
        .from(schema.platformAlerts)
        .where(isNull(schema.platformAlerts.acknowledgedAt))
        .orderBy(desc(schema.platformAlerts.createdAt))
        .limit(100),
    ]);
    return {
      sources: LEGISLATION_SOURCES.map((s) => ({
        key: s.key,
        label: s.label,
        url: s.url,
        datasets: s.datasets,
        state: rows.find((r) => r.key === s.key) ?? null,
      })),
      alerts,
      checked: datasetDates(rows),
    };
  }

  /**
   * A reviewed alert. Once a source has no open alerts left, its current
   * content becomes the confirmed baseline and its datasets' "last
   * checked" dates move forward again.
   */
  async acknowledge(id: string) {
    const db = this.dbService.db;
    const [alert] = await db
      .update(schema.platformAlerts)
      .set({ acknowledgedAt: new Date() })
      .where(and(eq(schema.platformAlerts.id, id), isNull(schema.platformAlerts.acknowledgedAt)))
      .returning();
    if (!alert) throw new NotFoundException("alert_not_found");
    if (alert.sourceKey) {
      const open = await db
        .select({ id: schema.platformAlerts.id })
        .from(schema.platformAlerts)
        .where(and(eq(schema.platformAlerts.sourceKey, alert.sourceKey), isNull(schema.platformAlerts.acknowledgedAt)))
        .limit(1);
      if (!open.length) {
        await db
          .update(schema.legislationSources)
          .set({ status: "ok", confirmedAt: new Date() })
          .where(and(eq(schema.legislationSources.key, alert.sourceKey), eq(schema.legislationSources.status, "changed")));
      }
    }
    return alert;
  }

  /** Per-dataset dates for public pages; null where the monitor has nothing confirmed yet. */
  async checkedDates() {
    const rows = await this.dbService.db
      .select({ key: schema.legislationSources.key, confirmedAt: schema.legislationSources.confirmedAt })
      .from(schema.legislationSources);
    return datasetDates(rows);
  }
}
