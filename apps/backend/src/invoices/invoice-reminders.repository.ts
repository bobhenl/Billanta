import { Injectable, Logger } from "@nestjs/common";
import { and, eq, isNull, lt, or, sql as dsql } from "drizzle-orm";
import * as schema from "../../drizzle/schema";
import { DbService } from "../db/db.service";
import { drizzleTx } from "../db/drizzle-tx";
import { REMINDER_COOLDOWN_DAYS } from "./invoice-reminders.util";

export interface OverdueInvoiceForReminder {
  invoice: typeof schema.invoices.$inferSelect;
  contactEmail: string | null;
  lineItems: (typeof schema.invoiceLineItems.$inferSelect)[];
}

/**
 * Data access for `InvoiceRemindersCron`. Split out of the cron class
 * itself so its orchestration logic (who gets emailed, error handling per
 * invoice) is unit-testable against a plain mocked interface — the same
 * pattern `TenantBillingRepository`/`SubscriptionEventsRepository` use for
 * `BillingService`.
 *
 * ============================================================================
 * Cross-tenant query — reuses `list_tenant_ids()`, NOT a new SECURITY
 * DEFINER function.
 * ============================================================================
 * This cron job is a legitimate exception to per-request RLS scoping: it's
 * an internal system job, not a user request acting on behalf of one
 * tenant, and its whole point is to look across every tenant's overdue
 * invoices. `RecurringInvoiceGenerationService`
 * (`src/recurring-invoices/recurring-invoice-generation.service.ts`) hit
 * the exact same "daily job must scan every tenant" shape first and added
 * `list_tenant_ids()` — a SECURITY DEFINER function in
 * `drizzle/rls-policies.sql` that returns ONLY the `id` column of every
 * tenant, explicitly documented there as "the ONLY place in the app that
 * enumerates every tenant at once." This class reuses that existing
 * function rather than adding a second, overlapping one — that IS the
 * intended reuse (the file's caveat is about not using it as a shortcut
 * when a *specific* tenant id is already resolvable some other way, which
 * doesn't apply to this job either).
 *
 * `invoices` itself keeps `ENABLE`/`FORCE ROW LEVEL SECURITY` fully intact:
 *   1. `listAllTenantIds` calls `list_tenant_ids()` through the shared pool
 *      — no invoice content, no contact data, nothing beyond a tenant id.
 *   2. `findOverdueInvoicesForTenant` then applies the actual eligibility
 *      filter (see `isDueForReminder`'s doc comment) as a normal,
 *      RLS-scoped query — `sql.begin()` + `set_config('app.current_tenant_id',
 *      ...)`, exactly `TenantContextMiddleware`'s pattern — for ONE tenant
 *      at a time. A tenant with no overdue invoices simply gets an empty
 *      result back (same approach `RecurringInvoiceGenerationService` takes
 *      for tenants with no due templates) — cheap, and there is no
 *      authoritative-vs-approximate split to get wrong here, since this is
 *      the one and only place the filter is actually applied.
 */
@Injectable()
export class InvoiceRemindersRepository {
  private readonly logger = new Logger(InvoiceRemindersRepository.name);

  constructor(private readonly dbService: DbService) {}

  /**
   * Calls `list_tenant_ids()` through the shared pool (`DbService.db`) —
   * safe with no tenant context set specifically because the SECURITY
   * DEFINER function itself, not the caller's RLS context, is what scopes
   * the result (see the class doc comment). Query shape matches
   * `RecurringInvoiceGenerationService.listTenantIds` exactly, for
   * consistency across this codebase's two cross-tenant `@Cron` jobs.
   */
  async listAllTenantIds(): Promise<string[]> {
    const rows = await this.dbService.db.execute<{ tenant_id: string }>(
      dsql`SELECT * FROM list_tenant_ids() AS t(tenant_id)`,
    );
    return rows.map((row) => row.tenant_id);
  }

  /**
   * Real, RLS-safe read for a single, already-known tenant — mirrors
   * `TenantContextMiddleware`'s `sql.begin(...)` + `set_config(...)`
   * pattern using a `tenantId` this class already resolved via
   * {@link listAllTenantIds}. Returns an empty array for a tenant with no
   * reminder-eligible invoices right now.
   */
  async findOverdueInvoicesForTenant(tenantId: string): Promise<OverdueInvoiceForReminder[]> {
    return this.dbService.sql.begin(async (tx) => {
      await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;
      const db = drizzleTx(tx, schema);
      const cooldownCutoff = new Date(Date.now() - REMINDER_COOLDOWN_DAYS * 24 * 60 * 60 * 1000);

      const rows = await db
        .select({ invoice: schema.invoices, contactEmail: schema.contacts.email })
        .from(schema.invoices)
        .leftJoin(schema.contacts, eq(schema.invoices.contactId, schema.contacts.id))
        .where(
          and(
            eq(schema.invoices.status, "issued"),
            lt(schema.invoices.dueDate, new Date()),
            or(
              isNull(schema.invoices.lastReminderSentAt),
              lt(schema.invoices.lastReminderSentAt, cooldownCutoff),
            ),
          ),
        );

      const results: OverdueInvoiceForReminder[] = [];
      for (const row of rows) {
        const lineItems = await db
          .select()
          .from(schema.invoiceLineItems)
          .where(eq(schema.invoiceLineItems.invoiceId, row.invoice.id));
        results.push({ invoice: row.invoice, contactEmail: row.contactEmail, lineItems });
      }
      return results;
    });
  }

  /** Marks a reminder as sent — increments `reminder_count`, stamps `last_reminder_sent_at`. */
  async recordReminderSent(tenantId: string, invoiceId: string): Promise<void> {
    await this.dbService.sql.begin(async (tx) => {
      await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;
      const db = drizzleTx(tx, schema);
      await db
        .update(schema.invoices)
        .set({
          reminderCount: dsql`${schema.invoices.reminderCount} + 1`,
          lastReminderSentAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(schema.invoices.id, invoiceId));
    });
    this.logger.log(`invoice ${invoiceId} (tenant ${tenantId}): reminder recorded`);
  }
}
