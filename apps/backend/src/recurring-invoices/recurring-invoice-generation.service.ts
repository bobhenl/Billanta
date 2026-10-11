import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { eq, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "../../drizzle/schema";
import { DbService } from "../db/db.service";
import { drizzleTx } from "../db/drizzle-tx";
import { advanceNextRunDate, isTemplateDue } from "./schedule";

type TenantDb = PostgresJsDatabase<typeof schema>;
type RecurringTemplateRow = typeof schema.recurringInvoiceTemplates.$inferSelect;
type LineItemSnapshot = {
  description: string;
  quantity: number;
  unitPrice: number;
  vatRate?: number | null;
};

/**
 * Daily job that materializes real `invoices` (+ `invoice_line_items`) rows
 * from due `recurring_invoice_templates`, per the generation-job brief:
 * scan ALL tenants, one per-tenant RLS-scoped transaction at a time, never
 * a wholesale RLS bypass.
 *
 * ============================================================================
 * WHY `list_tenant_ids()` — the same cross-tenant chicken-and-egg problem
 * `TenantBillingRepository` already solves, applied to a new caller.
 * ============================================================================
 * `tenants` has `FORCE ROW LEVEL SECURITY` (drizzle/rls-policies.sql), so a
 * plain pooled `SELECT id FROM tenants` via `DbService.db` returns ZERO rows
 * against a real RLS-enabled Postgres instance — there is no
 * `app.current_tenant_id` set yet, and this job's whole job is to iterate
 * every tenant, not act within one that's already known. This is exactly
 * the shape `TenantBillingRepository.findTenantIdByStripeCustomerId` /
 * `findTenantIdByGopayPayerId` hit (see that file + the "SECURITY DEFINER
 * lookup functions" section of `drizzle/rls-policies.sql`), just "give me
 * every id" instead of "give me the id matching this external key".
 *
 * Rather than bypassing RLS wholesale (e.g. connecting as a superuser/
 * BYPASSRLS role for this job), this reuses that file's established
 * narrow-door pattern: `list_tenant_ids()` is a new `SECURITY DEFINER`
 * function, added to `drizzle/rls-policies.sql` alongside the existing
 * ones, that returns ONLY the `id` column of every tenant — no company
 * name, IČO/DIČ, address, or subscription status — and is granted to
 * `faktur_app` alone. Once a tenant id is in hand, every subsequent query
 * for that tenant goes through the normal `sql.begin()` +
 * `set_config('app.current_tenant_id', ...)` transaction pattern
 * (`TenantContextMiddleware`, `TenantBillingRepository.updateSubscriptionStatus`)
 * — RLS is fully back in force for the actual template/invoice reads and
 * writes below, per tenant.
 */
@Injectable()
export class RecurringInvoiceGenerationService {
  private readonly logger = new Logger(RecurringInvoiceGenerationService.name);

  constructor(private readonly dbService: DbService) {}

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async run(): Promise<void> {
    const asOf = new Date();
    const tenantIds = await this.listTenantIds();

    let totalGenerated = 0;
    for (const tenantId of tenantIds) {
      try {
        totalGenerated += await this.generateForTenant(tenantId, asOf);
      } catch (err) {
        // One tenant's failure (e.g. a malformed lineItemsSnapshot) must
        // never abort the whole run — every other tenant still needs their
        // due invoices generated today.
        this.logger.error(
          `recurring-invoice generation failed for tenant ${tenantId}: ${(err as Error).message}`,
          (err as Error).stack,
        );
      }
    }

    this.logger.log(
      `recurring-invoice generation: ${totalGenerated} invoice(s) created across ${tenantIds.length} tenant(s)`,
    );
  }

  private async listTenantIds(): Promise<string[]> {
    const rows = await this.dbService.db.execute<{ tenant_id: string }>(
      sql`SELECT * FROM list_tenant_ids() AS t(tenant_id)`,
    );
    return rows.map((r) => r.tenant_id);
  }

  /**
   * Runs the whole due-template scan + materialization for one tenant
   * inside a single `sql.begin()` transaction with
   * `app.current_tenant_id` set — mirrors
   * `TenantContextMiddleware`/`TenantBillingRepository`'s pattern exactly.
   * Returns the number of invoices generated (public + used by tests via
   * dependency-injected fakes, not exercised against a real DB here — see
   * `schedule.spec.ts` for what IS covered by real unit tests: the pure
   * due-template/date-advancement math this method delegates to).
   */
  async generateForTenant(tenantId: string, asOf: Date = new Date()): Promise<number> {
    let generated = 0;

    await this.dbService.sql.begin(async (tx) => {
      await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;
      const db = drizzleTx(tx, schema);

      // Select ALL of this tenant's templates (RLS already scopes this to
      // the one tenant) and filter with `isTemplateDue` rather than
      // encoding the same "active AND due" condition a second time as a
      // SQL `WHERE` clause — one source of truth, and the exact function
      // `schedule.spec.ts` unit-tests. Template counts per tenant are small
      // (this is not a hot path over millions of rows like invoice
      // listing), so selecting the full set costs nothing meaningful.
      const templates = await db.select().from(schema.recurringInvoiceTemplates);
      const due = templates.filter((t) => isTemplateDue(t, asOf));

      for (const template of due) {
        await this.materialize(db, tenantId, template);
        generated++;
      }
    });

    return generated;
  }

  private async materialize(
    db: TenantDb,
    tenantId: string,
    template: RecurringTemplateRow,
  ): Promise<void> {
    // --- Invoice numbering: deliberately NOT allocated here ---
    // `InvoicesService.createDraft` (the only other place that creates an
    // `invoices` row today) never sets `invoiceNumber` either — CZ/SK law
    // requires sequential numbers to be allocated only at issue time
    // (blueprint §6 step 8), and `InvoicesController.issue` /
    // `invoice_number_sequences` allocation is a `NotImplementedException`
    // TODO stub as of this change (see invoices.controller.ts). So a
    // generated recurring invoice leaves `invoiceNumber` unset, exactly
    // like a manually-created draft — there is no numbering logic to reuse
    // yet, and this job does not invent its own.
    const [invoice] = await db
      .insert(schema.invoices)
      .values({
        tenantId,
        contactId: template.contactId,
        currency: template.currency,
        status: "draft",
        source: "recurring",
      })
      .returning();

    const lineItems = (template.lineItemsSnapshot ?? []) as LineItemSnapshot[];
    if (lineItems.length > 0) {
      await db.insert(schema.invoiceLineItems).values(
        lineItems.map((item, index) => ({
          tenantId,
          invoiceId: invoice.id,
          description: item.description,
          quantity: item.quantity.toString(),
          unitPrice: item.unitPrice.toString(),
          vatRate: item.vatRate != null ? item.vatRate.toString() : null,
          sortOrder: index,
        })),
      );
    }

    const nextRunDate = advanceNextRunDate(
      template.nextRunDate,
      template.frequency,
      template.intervalCount,
    );
    await db
      .update(schema.recurringInvoiceTemplates)
      .set({ nextRunDate, updatedAt: new Date() })
      .where(eq(schema.recurringInvoiceTemplates.id, template.id));
  }
}
