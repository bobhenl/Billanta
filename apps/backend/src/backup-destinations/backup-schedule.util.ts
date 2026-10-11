/** Minimal shape `isBackupDue` needs — kept structural rather than importing the full Drizzle row type. */
export interface BackupDueCheckInput {
  isActive: boolean;
  schedule: "daily" | "weekly" | "manual";
  lastRunAt: Date | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Pure predicate, kept free of any DB/Nest dependency (same rationale as
 * `recurring-invoices/schedule.ts`'s `isTemplateDue`/`advanceNextRunDate`)
 * specifically so it has real, DB-free unit test coverage
 * (`backup-schedule.util.spec.ts`) — `BackupExportCron`'s hourly sweep
 * delegates to this rather than re-encoding the same "active AND due"
 * condition as a SQL `WHERE` clause, one source of truth for the rule.
 *
 * `manual` destinations are NEVER due via the scheduler — they only ever run
 * via the explicit `POST /:id/run-now` endpoint. `daily`/`weekly` are due
 * when they've never run (`lastRunAt === null`) or their last run is at
 * least a full period old. The `@Cron` job itself runs hourly (not exactly
 * at day/week boundaries), so this deliberately checks "at least N days
 * since last run" rather than "is it a new calendar day/week" — a coarser,
 * simpler rule that's still correct for a periodic background export
 * (unlike invoice numbering or a calendar-accurate billing cycle, being off
 * by a few hours here has no real consequence).
 */
export function isBackupDue(destination: BackupDueCheckInput, asOf: Date = new Date()): boolean {
  if (!destination.isActive || destination.schedule === "manual") {
    return false;
  }
  if (destination.lastRunAt === null) {
    return true;
  }

  const periodDays = destination.schedule === "daily" ? 1 : 7;
  const elapsedMs = asOf.getTime() - destination.lastRunAt.getTime();
  return elapsedMs >= periodDays * DAY_MS;
}
