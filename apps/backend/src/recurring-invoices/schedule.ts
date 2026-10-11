/**
 * Pure date/scheduling math for recurring invoice templates
 * (`drizzle/schema.ts`'s `recurringInvoiceTemplates`). Deliberately kept
 * free of any DB/Nest dependency so it can be unit-tested directly (see
 * `schedule.spec.ts`) — `RecurringInvoiceGenerationService` is the only
 * caller and does nothing more than wire these functions up to a
 * transaction.
 */

export type RecurringFrequency = "weekly" | "monthly" | "quarterly" | "yearly";

/**
 * Advances `from` by `frequency` x `intervalCount` — e.g. frequency=monthly,
 * intervalCount=2 => +2 months (see the doc comment on
 * `recurringInvoiceTemplates.intervalCount` in `drizzle/schema.ts`).
 *
 * Calendar-aware: uses `Date`'s own month/day rollover rather than a
 * fixed-days approximation, so "monthly" always means "same day N months
 * later", not "+30 days" (which would drift across months of different
 * lengths). One consequence worth knowing about, not a bug: advancing a
 * short month like "Jan 31" by one month has no "Feb 31" to land on, so
 * native `Date` rolls it over into March (e.g. Jan 31 + 1 month = Mar 3 in
 * a non-leap year) rather than clamping to Feb's last day. Covered
 * explicitly in `schedule.spec.ts` so this stays a documented, intentional
 * behavior rather than a silent surprise.
 *
 * Operates in UTC to match `nextRunDate`'s Drizzle column, which is
 * declared `{ withTimezone: true, mode: "date" }` (a real `timestamptz`
 * column read back into JS as a `Date` at UTC midnight).
 */
export function advanceNextRunDate(
  from: Date,
  frequency: RecurringFrequency,
  intervalCount: number,
): Date {
  const result = new Date(from.getTime());

  switch (frequency) {
    case "weekly":
      result.setUTCDate(result.getUTCDate() + 7 * intervalCount);
      break;
    case "monthly":
      result.setUTCMonth(result.getUTCMonth() + intervalCount);
      break;
    case "quarterly":
      result.setUTCMonth(result.getUTCMonth() + intervalCount * 3);
      break;
    case "yearly":
      result.setUTCFullYear(result.getUTCFullYear() + intervalCount);
      break;
    default: {
      // Exhaustiveness guard — throws instead of silently no-op-ing if the
      // `recurring_frequency` Postgres enum (drizzle/schema.ts) ever grows a
      // value this function hasn't been taught about yet.
      const exhaustive: never = frequency;
      throw new Error(`Unknown recurring frequency: ${String(exhaustive)}`);
    }
  }

  return result;
}

export interface DueCheckTemplate {
  isActive: boolean;
  nextRunDate: Date;
}

/**
 * Single source of truth for "is this template due to run", used by
 * `RecurringInvoiceGenerationService` and directly unit-tested in
 * `schedule.spec.ts` — rather than re-deriving the same condition in SQL
 * and in tests (which risks the two silently drifting apart), the service
 * selects a tenant's templates and filters them through this one function.
 *
 * Date-only comparison: both `nextRunDate` and `asOf` are truncated to a
 * UTC calendar day before comparing, so a `nextRunDate` of "today at
 * midnight UTC" is due regardless of what time of day the cron actually
 * runs at.
 */
export function isTemplateDue(template: DueCheckTemplate, asOf: Date): boolean {
  if (!template.isActive) {
    return false;
  }
  return startOfUtcDay(template.nextRunDate).getTime() <= startOfUtcDay(asOf).getTime();
}

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}
