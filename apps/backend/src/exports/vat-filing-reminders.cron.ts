import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { isLegalEntityName, type TaxProfile } from "@faktur/cz-compliance";
import { eq, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "../../drizzle/schema";
import { sendingBlock } from "../abuse/sending-guard";
import { planAllows } from "../billing/plan-access";
import { loadPlanSummary } from "../billing/plan.guard";
import { DashboardService } from "../dashboard/dashboard.service";
import { upcomingTaxEvents, type TaxEvent } from "../dashboard/tax-calendar";
import { DbService } from "../db/db.service";
import { drizzleTx } from "../db/drizzle-tx";
import { appUrlOf, emailLocaleOf } from "../email/email-render";
import { EmailOutboxService, unsubscribeFor } from "../email/email-outbox.service";
import { chosenTaxKinds } from "../email/weekly-digest.cron";
import { afterQuietHours } from "../email/outbox-policy";
import { dispatchWebhooks } from "../integrations/webhooks";
import { notificationPrefsOf } from "../notifications/notification-prefs";
import { effectivePermissions } from "../tenancy/permissions";
import { ExportsService, VatRateUnavailableError } from "./exports.service";
import {
  AHEAD_DAYS,
  dueTaxOfDp3,
  filingKey,
  filingsToCheck,
  groupByDueDay,
  isoDay,
  periodKey,
  recipientsFor,
  reminderCandidates,
  reminderIdempotencyKey,
  remindersToSend,
  renderVatFilingReminder,
  sentKey,
  vatKindsOf,
  type FilingCheck,
  type FilingPeriod,
  type ReminderMember,
  type ReminderStage,
  type VatReminderKind,
} from "./vat-filing-reminders";

type Db = PostgresJsDatabase<typeof schema>;
type Tenant = typeof schema.tenants.$inferSelect;

const siteUrl = () => (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3100").replace(/\/$/, "");
const EXPORTS_PATH = "/settings/exports";

/**
 * Daily 7:00 Prague: a VAT filing reminder 1–3 days before the due day and
 * on the day itself, for every company with a VAT status. A payer's return
 * and KH are always due; an identified person's return and the EC sales list
 * only when the period has something in them, which the same builders as the
 * download decide. Each kind, period and stage is stored once in
 * vat_filing_reminders, so a rerun or a restart mails nobody twice.
 */
@Injectable()
export class VatFilingRemindersCron {
  private readonly logger = new Logger(VatFilingRemindersCron.name);

  constructor(
    private readonly dbService: DbService,
    private readonly outbox: EmailOutboxService,
    private readonly exports: ExportsService,
    private readonly dashboard: DashboardService,
  ) {}

  @Cron("0 7 * * *", { timeZone: "Europe/Prague" })
  async run(now = new Date()): Promise<number> {
    const tenants = await this.dbService.db.execute<{ tenant_id: string }>(sql`SELECT * FROM list_tenant_ids() AS t(tenant_id)`);
    const official = await upcomingTaxEvents(AHEAD_DAYS + 1, now).catch(() => null);
    let sent = 0;
    for (const { tenant_id: tenantId } of tenants) {
      try {
        sent += await this.forTenant(tenantId, now, official);
      } catch (err) {
        this.logger.error(`VAT filing reminders for tenant ${tenantId} failed: ${err instanceof Error ? err.message : err}`);
      }
    }
    if (sent) this.logger.log(`VAT filing reminders: ${sent} reminder(s) sent`);
    return sent;
  }

  private async forTenant(tenantId: string, now: Date, official: TaxEvent[] | null): Promise<number> {
    const hooks: { title: string; body: string }[] = [];
    let tenant: Tenant | undefined;
    const sent = (await this.dbService.sql.begin(async (tx) => {
      await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;
      const db = drizzleTx(tx, schema);
      [tenant] = await db.select().from(schema.tenants).where(eq(schema.tenants.id, tenantId));
      if (!tenant || tenant.vatStatus === "non_payer" || !tenant.vatStatus) return 0;
      const profile: TaxProfile = { country: tenant.country ?? "CZ", vatStatus: tenant.vatStatus, legalEntity: isLegalEntityName(tenant.legalName) };

      const rows = await db
        .select({
          userId: schema.tenantMemberships.userId,
          role: schema.tenantMemberships.role,
          permissions: schema.tenantMemberships.permissions,
          prefs: schema.tenantMemberships.notificationPrefs,
          tiles: schema.tenantMemberships.dashboardTiles,
          email: schema.users.email,
        })
        .from(schema.tenantMemberships)
        .innerJoin(schema.users, eq(schema.users.id, schema.tenantMemberships.userId))
        .where(eq(schema.tenantMemberships.tenantId, tenantId));
      const members: (ReminderMember & { quietHours: ReturnType<typeof notificationPrefsOf>["quietHours"] })[] = rows.map((m) => {
        const prefs = notificationPrefsOf(m.prefs, m.role);
        return {
          userId: m.userId,
          email: m.email,
          channels: prefs.events.vat_filing_due,
          reports: effectivePermissions(m.role, m.permissions).reports,
          kinds: vatKindsOf(chosenTaxKinds(m.tiles, profile), profile),
          quietHours: prefs.quietHours,
        };
      });
      const kinds = [...new Set(members.filter((m) => m.reports !== "none").flatMap((m) => m.kinds))] as VatReminderKind[];
      if (!kinds.length) return 0;

      const stored = await db
        .select({ kind: schema.vatFilingReminders.kind, period: schema.vatFilingReminders.period, stage: schema.vatFilingReminders.stage })
        .from(schema.vatFilingReminders);
      const already = new Set(stored.map((r) => sentKey(r.kind, r.period, r.stage as ReminderStage)));
      const candidates = reminderCandidates(kinds, profile, official, now, already);
      if (!candidates.length) return 0;

      const checks = await this.checkFilings(db, tenantId, tenant, filingsToCheck(candidates), now);
      const due = remindersToSend(candidates, checks);
      if (!due.length) return 0;

      // Marked even when nobody gets an e-mail, so the bell row is not repeated tomorrow.
      await db
        .insert(schema.vatFilingReminders)
        .values(due.map((r) => ({ tenantId, kind: r.kind, period: r.periodKey, stage: r.stage, dueDate: isoDay(r.dueDate) })))
        .onConflictDoNothing();

      // The reminder is a mail to the company's own people, so it does not count
      // toward the daily cap on customer mail; a blocked company gets the bell only.
      const mayEmail = sendingBlock(tenant, 0, now) === null;
      const locale = emailLocaleOf(tenant.defaultLocale);
      const exportsUrl = appUrlOf(siteUrl(), locale, EXPORTS_PATH);
      for (const group of groupByDueDay(due)) {
        const to = recipientsFor(members, group, mayEmail);
        const plain = renderVatFilingReminder(group, { locale, company: tenant.companyName, exportsUrl, unsubscribeUrl: null });
        if (to.app.length) {
          await db.insert(schema.notifications).values(
            to.app.map((m) => ({
              tenantId,
              userId: m.userId,
              kind: "vat_filing_due",
              title: plain.title.slice(0, 200),
              body: plain.body,
              link: EXPORTS_PATH,
            })),
          );
        }
        for (const m of to.email) {
          const member = members.find((x) => x.userId === m.userId)!;
          const unsub = unsubscribeFor(tenantId, m.userId, "vat_filing_due", locale);
          const mail = renderVatFilingReminder(group, { locale, company: tenant.companyName, exportsUrl, unsubscribeUrl: unsub.pageUrl });
          await this.outbox.enqueue(
            {
              kind: "vat_filing_due",
              category: "notification",
              to: m.email!,
              userId: m.userId,
              subject: mail.subject,
              html: mail.html,
              text: mail.text,
              headers: unsub.headers,
              idempotencyKey: reminderIdempotencyKey(m.userId, group),
              sendAfter: afterQuietHours(now, member.quietHours),
            },
            { tenantId, db },
          );
        }
        hooks.push({ title: plain.title, body: plain.body });
      }
      if (hooks.length) {
        const plan = await loadPlanSummary(db, tenantId);
        if (plan && !planAllows(plan, "webhooks")) hooks.length = 0;
      }
      return due.length;
    })) as number;

    for (const h of hooks) {
      await dispatchWebhooks(tenant?.webhooks, "vat_filing_due", { ...h, link: EXPORTS_PATH }, { company: tenant?.companyName ?? "", siteUrl: siteUrl() }).catch(
        (err) => this.logger.warn(`Webhook dispatch failed: ${err instanceof Error ? err.message : err}`),
      );
    }
    return sent;
  }

  /**
   * Asks the export whether each conditional filing has something in it. A
   * missing exchange rate leaves the filing out of the result, so it counts
   * as not due today and is asked again tomorrow.
   */
  private async checkFilings(db: Db, tenantId: string, tenant: Tenant, filings: FilingPeriod[], now: Date): Promise<Map<string, FilingCheck>> {
    const out = new Map<string, FilingCheck>();
    let activity: Awaited<ReturnType<DashboardService["vatActivity"]>> | undefined;
    for (const f of filings) {
      try {
        if (f.filing.country === "SK" && f.filing.kind === "dph" && tenant.vatStatus === "identified") {
          // The Slovak return builder has no identified mode; the dashboard's
          // activity scan already knows the months with a service bought abroad.
          activity ??= await this.dashboard.vatActivity(db, tenantId, now);
          out.set(filingKey(f), { due: activity.foreignPurchaseMonths.includes(periodKey(f.period)), tax: null });
          continue;
        }
        const from = "quarter" in f.period ? new Date(f.period.year, (f.period.quarter - 1) * 3, 1) : new Date(f.period.year, f.period.month - 1, 1);
        const to = "quarter" in f.period ? new Date(f.period.year, f.period.quarter * 3, 1) : new Date(f.period.year, f.period.month, 1);
        const res = await this.exports.vatFilingCheck(db, f.filing, { from, to }, f.period, tenant);
        const unmarked = res.warnings.some((w) => w.code === "foreign_purchase_unmarked");
        out.set(filingKey(f), {
          due: res.due,
          tax: f.filing.kind === "dp3" && !unmarked ? dueTaxOfDp3(res.xml) : null,
          sealed: res.sealed,
          unmarked,
        });
      } catch (err) {
        if (!(err instanceof VatRateUnavailableError)) throw err;
        this.logger.warn(`VAT filing check ${filingKey(f)} for tenant ${tenantId} skipped: ${err.message}`);
      }
    }
    return out;
  }
}
