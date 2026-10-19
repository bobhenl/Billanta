import { Injectable, Logger } from "@nestjs/common";
import { and, eq, isNull, lt, ne, or, sql as dsql } from "drizzle-orm";
import { assertCanSendEmail, recordEmailSent } from "../abuse/sending-guard";
import type { EmailCustomization } from "../email/email.service";
import { emailCustomizationOf, emailPrefsOf } from "../tenants/email-prefs";
import { templateValues } from "../tenants/template-vars";
import { clientPortalLinkOf, invoiceLinkOf } from "../public-links/public-link";
import { applyBuyerSnapshot, applySellerSnapshot } from "./party-snapshot";
import { reminderPrefsOf } from "../tenants/invoice-form-prefs";
import * as schema from "../../drizzle/schema";
import { DbService } from "../db/db.service";
import { drizzleTx } from "../db/drizzle-tx";
import { BRAND_CREDIT_TENANT_FIELDS, brandCreditFor, type BrandCredit } from "./brand-credit";

export interface OverdueInvoiceForReminder {
  invoice: typeof schema.invoices.$inferSelect;
  contactEmail: string | null;
  /** Path segments for the e-mail's links (public-links/public-link.ts); the portal one only when it is on. */
  publicLink: string;
  clientPortalLink?: string | null;
  lineItems: (typeof schema.invoiceLineItems.$inferSelect)[];
  /** Settings → E-maily wording/sender for this tenant's reminder. */
  custom?: EmailCustomization;
  /** The "Vystaveno v Billantě" line, or null when the company switched it off. */
  credit?: BrandCredit | null;
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
      // Settings → Invoices: reminders can be switched off, spaced out and capped.
      const [tenant] = await db
        .select({
          prefs: schema.tenants.invoiceFormPrefs,
          emailPrefs: schema.tenants.emailPrefs,
          companyName: schema.tenants.companyName,
          email: schema.tenants.email,
          // for Settings -> Proměnné in the reminder text
          ico: schema.tenants.ico,
          dic: schema.tenants.dic,
          phone: schema.tenants.phone,
          website: schema.tenants.website,
          addressStreet: schema.tenants.addressStreet,
          addressCity: schema.tenants.addressCity,
          addressPostalCode: schema.tenants.addressPostalCode,
          bankAccountNumber: schema.tenants.bankAccountNumber,
          bankAccountBankCode: schema.tenants.bankAccountBankCode,
          bankAccountIban: schema.tenants.bankAccountIban,
          templateVars: schema.tenants.templateVars,
          publicProfile: schema.tenants.publicProfile,
          // plan, prefs (also the readable link prefix) and referral code for the "Vystaveno v Billantě" line
          ...BRAND_CREDIT_TENANT_FIELDS,
        })
        .from(schema.tenants)
        .where(eq(schema.tenants.id, tenantId))
        .limit(1);
      const rules = reminderPrefsOf(tenant?.prefs);
      if (!rules.enabled) return [];
      const cooldownCutoff = new Date(Date.now() - rules.intervalDays * 24 * 60 * 60 * 1000);

      const rows = await db
        .select({ invoice: schema.invoices, contactEmail: schema.contacts.email, contactName: schema.contacts.legalName, contactIco: schema.contacts.ico, contactPortalToken: schema.contacts.portalToken, contactPortalKey: schema.contacts.portalKey, contactPortalSlug: schema.contacts.portalSlug })
        .from(schema.invoices)
        .leftJoin(schema.contacts, eq(schema.invoices.contactId, schema.contacts.id))
        .where(
          and(
            eq(schema.invoices.status, "issued"),
            // History brought in from another system: its old system already did the chasing.
            ne(schema.invoices.source, "import"),
            lt(schema.invoices.dueDate, new Date()),
            lt(schema.invoices.reminderCount, rules.max),
            or(
              isNull(schema.invoices.lastReminderSentAt),
              lt(schema.invoices.lastReminderSentAt, cooldownCutoff),
            ),
          ),
        );

      const credit = tenant ? brandCreditFor(tenant, "cs", "email") : null;
      const results: OverdueInvoiceForReminder[] = [];
      for (const row of rows) {
        const lineItems = await db
          .select()
          .from(schema.invoiceLineItems)
          .where(eq(schema.invoiceLineItems.invoiceId, row.invoice.id));
        // Variables as on the document: its supplier/buyer snapshot when it has one.
        const docTenant = tenant ? applySellerSnapshot(tenant, row.invoice.sellerSnapshot) : tenant;
        const buyer = row.contactName
          ? applyBuyerSnapshot({ legalName: row.contactName, ico: row.contactIco ?? null, portalToken: row.contactPortalToken, portalKey: row.contactPortalKey, portalSlug: row.contactPortalSlug }, row.invoice.buyerSnapshot)
          : null;
        const vars = templateValues(docTenant, row.invoice, buyer);
        const custom = emailCustomizationOf(emailPrefsOf(tenant?.emailPrefs), "reminder", tenant, buyer?.legalName ?? undefined, vars);
        results.push({
          invoice: row.invoice,
          contactEmail: row.contactEmail,
          publicLink: invoiceLinkOf(docTenant, row.invoice),
          clientPortalLink: buyer ? clientPortalLinkOf(docTenant, buyer) : null,
          lineItems,
          custom,
          credit,
        });
      }
      return results;
    });
  }

  /** Throws when the tenant is suspended, paused or over today's e-mail cap (`abuse/sending-guard.ts`). */
  async assertCanSend(tenantId: string): Promise<void> {
    await this.dbService.sql.begin(async (tx) => {
      await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;
      await assertCanSendEmail(drizzleTx(tx, schema), tenantId);
    });
  }

  /** Marks a reminder as sent — increments `reminder_count`, stamps `last_reminder_sent_at`, counts it towards the cap. */
  async recordReminderSent(tenantId: string, invoiceId: string, recipient?: string): Promise<void> {
    await this.dbService.sql.begin(async (tx) => {
      await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;
      const db = drizzleTx(tx, schema);
      if (recipient) await recordEmailSent(db, tenantId, "reminder", recipient);
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
