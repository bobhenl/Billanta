/**
 * Pure predicate for "is this invoice due for an overdue-payment reminder
 * today?" — the same rule is expressed twice elsewhere as SQL, and this
 * function exists so the *rule itself* has one small, readable,
 * unit-testable definition instead of only ever living as SQL prose:
 *
 *   1. `list_tenants_with_overdue_invoices()` (`drizzle/rls-policies.sql`)
 *      — the SECURITY DEFINER function that discovers which tenants have
 *      any reminder-eligible invoice at all, run with no tenant context.
 *   2. `InvoiceRemindersRepository.findOverdueInvoicesForTenant` — the
 *      real, RLS-scoped SELECT that fetches the actual rows once a
 *      tenant's transaction context is open.
 *
 * Both of those are the actual authoritative filters (this function is not
 * wired into either query directly) — but all three encode the exact same
 * three conditions, so a test against this function is effectively a test
 * against the shared business rule both SQL statements implement.
 */
export interface ReminderEligibilityInput {
  status: string;
  dueDate: Date | null;
  lastReminderSentAt: Date | null;
}

/** Matches the `interval '7 days'` cooldown in `rls-policies.sql` / the repository. */
export const REMINDER_COOLDOWN_DAYS = 7;

export function isDueForReminder(
  invoice: ReminderEligibilityInput,
  now: Date = new Date(),
): boolean {
  if (invoice.status !== "issued") {
    return false;
  }
  if (!invoice.dueDate || invoice.dueDate.getTime() >= now.getTime()) {
    return false;
  }
  if (invoice.lastReminderSentAt == null) {
    return true;
  }
  const cooldownCutoff = new Date(now.getTime() - REMINDER_COOLDOWN_DAYS * 24 * 60 * 60 * 1000);
  return invoice.lastReminderSentAt.getTime() < cooldownCutoff.getTime();
}
