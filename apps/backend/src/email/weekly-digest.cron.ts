import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import {
  TAX_DEADLINE_KINDS,
  defaultTaxDeadlineKinds,
  isLegalEntityName,
  taxDeadlinesFor,
  type TaxDeadlineKind,
  type TaxProfile,
} from "@faktur/cz-compliance";
import { and, eq, inArray, notInArray, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "../../drizzle/schema";
import { DbService } from "../db/db.service";
import { drizzleTx } from "../db/drizzle-tx";
import { upcomingTaxEvents, type TaxEvent } from "../dashboard/tax-calendar";
import { TAX_LABELS } from "../integrations/integrations.service";
import { computeVatBreakdown, formatInvoiceAmount, round2 } from "../invoices/invoice-total.util";
import { notificationPrefsOf } from "../notifications/notification-prefs";
import { effectivePermissions } from "../tenancy/permissions";
import { emailLocaleOf, type EmailLocale } from "./email-render";
import { EmailOutboxService, unsubscribeFor } from "./email-outbox.service";
import { isoWeekKey } from "./outbox-policy";
import { digestIsEmpty, renderWeeklyDigest, type DigestData, type DigestInvoice } from "./weekly-digest";

type Db = PostgresJsDatabase<typeof schema>;

const DAY = 86_400_000;
const siteUrl = () => (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3100").replace(/\/$/, "");

/**
 * Monday 8:00 Prague: the opt-in weekly digest for every member who turned
 * it on. The invoice part is computed once per company; tax deadlines use
 * the member's own deadline choice from the dashboard, through the same
 * `taxDeadlinesFor` as the dashboard tile and the calendar feed. Members
 * without access to invoices get only the deadlines. The idempotency key
 * (member + ISO week) keeps a restarted run from mailing anyone twice.
 */
@Injectable()
export class WeeklyDigestCron {
  private readonly logger = new Logger(WeeklyDigestCron.name);

  constructor(
    private readonly dbService: DbService,
    private readonly outbox: EmailOutboxService,
  ) {}

  @Cron("0 8 * * 1", { timeZone: "Europe/Prague" })
  async run(now = new Date()): Promise<number> {
    const tenants = await this.dbService.db.execute<{ tenant_id: string }>(sql`SELECT * FROM list_tenant_ids() AS t(tenant_id)`);
    const official = await upcomingTaxEvents(30, now).catch(() => null);
    let queued = 0;
    for (const { tenant_id: tenantId } of tenants) {
      try {
        queued += await this.forTenant(tenantId, now, official);
      } catch (err) {
        this.logger.error(`weekly digest for tenant ${tenantId} failed: ${err instanceof Error ? err.message : err}`);
      }
    }
    this.logger.log(`weekly digest: ${queued} e-mail(s) queued`);
    return queued;
  }

  private forTenant(tenantId: string, now: Date, official: TaxEvent[] | null): Promise<number> {
    return this.dbService.sql.begin(async (tx) => {
      await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;
      const db = drizzleTx(tx, schema);
      const members = await db
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
      const subscribers = members.filter((m) => m.email && notificationPrefsOf(m.prefs).weeklyDigest);
      if (!subscribers.length) return 0;

      const [t] = await db
        .select({
          company: schema.tenants.companyName,
          legalName: schema.tenants.legalName,
          locale: schema.tenants.defaultLocale,
          vatStatus: schema.tenants.vatStatus,
          country: schema.tenants.addressCountry,
        })
        .from(schema.tenants)
        .where(eq(schema.tenants.id, tenantId));
      const locale = emailLocaleOf(t?.locale);
      const profile: TaxProfile = { country: t?.country ?? "CZ", vatStatus: t?.vatStatus ?? "non_payer", legalEntity: isLegalEntityName(t?.legalName) };
      const invoices = await this.invoiceSummary(db, locale, now);

      let queued = 0;
      for (const m of subscribers) {
        const prefs = notificationPrefsOf(m.prefs);
        const seesInvoices = effectivePermissions(m.role, m.permissions).invoices !== "none";
        const unsub = unsubscribeFor(tenantId, m.userId, "weekly_digest", locale);
        const data: DigestData = {
          companyName: t?.company ?? "Billanta",
          ...(seesInvoices ? invoices : { unpaidTotals: [], unpaidCount: 0, overdue: [], overdueCount: 0, paid: [], paidTotals: [] }),
          deadlines: taxDeadlinesFor(chosenTaxKinds(m.tiles, profile), profile, official, now, 14).map((d) => ({
            label: TAX_LABELS[locale][d.kind],
            date: d.date,
            conditional: d.conditional,
          })),
          dashboardUrl: `${siteUrl()}/${locale}/dashboard`,
          unsubscribeUrl: unsub.pageUrl,
        };
        if (digestIsEmpty(data)) continue;
        const rendered = renderWeeklyDigest(data, locale);
        const id = await this.outbox.enqueueDigest(
          {
            kind: "weekly_digest",
            to: m.email,
            userId: m.userId,
            subject: rendered.subject,
            html: rendered.html,
            text: rendered.text,
            headers: unsub.headers,
            idempotencyKey: `weekly_digest:${m.userId}:${isoWeekKey(now)}`,
          },
          prefs.quietHours,
          { tenantId, db },
        );
        if (id) queued++;
      }
      return queued;
    }) as Promise<number>;
  }

  /** Unpaid and overdue issued invoices, and the ones paid in the last 7 days (quotes and credit notes left out). */
  private async invoiceSummary(db: Db, locale: EmailLocale, now: Date) {
    const rows = await db
      .select({ invoice: schema.invoices, customer: schema.contacts.legalName })
      .from(schema.invoices)
      .leftJoin(schema.contacts, eq(schema.contacts.id, schema.invoices.contactId))
      .where(
        and(
          notInArray(schema.invoices.documentType, ["quote", "credit_note"]),
          sql`(${schema.invoices.status} = 'issued' OR (${schema.invoices.status} = 'paid' AND ${schema.invoices.paidAt} >= ${new Date(now.getTime() - 7 * DAY)}))`,
        ),
      );
    const items = rows.length
      ? await db.select().from(schema.invoiceLineItems).where(inArray(schema.invoiceLineItems.invoiceId, rows.map((r) => r.invoice.id)))
      : [];
    const url = (id: string) => `${siteUrl()}/${locale}/invoices/${id}`;
    const unpaid = new Map<string, number>();
    const paidSums = new Map<string, number>();
    const overdue: (DigestInvoice & { sort: number })[] = [];
    const paid: (DigestInvoice & { sort: number })[] = [];
    let unpaidCount = 0;
    for (const { invoice, customer } of rows) {
      const total = computeVatBreakdown(
        items.filter((i) => i.invoiceId === invoice.id),
        { reverseCharge: invoice.reverseCharge },
      ).totalWithVat;
      const base = { number: invoice.invoiceNumber ?? "–", customer: customer ?? null, url: url(invoice.id) };
      if (invoice.status === "issued") {
        const outstanding = round2(total - Number(invoice.amountPaid ?? 0));
        if (outstanding <= 0) continue;
        unpaidCount++;
        unpaid.set(invoice.currency, round2((unpaid.get(invoice.currency) ?? 0) + outstanding));
        if (invoice.dueDate && invoice.dueDate.getTime() < now.getTime() - DAY / 2) {
          overdue.push({ ...base, amount: formatInvoiceAmount(outstanding, invoice.currency), date: invoice.dueDate, sort: invoice.dueDate.getTime() });
        }
      } else if (invoice.paidAt) {
        paidSums.set(invoice.currency, round2((paidSums.get(invoice.currency) ?? 0) + total));
        paid.push({ ...base, amount: formatInvoiceAmount(total, invoice.currency), date: invoice.paidAt, sort: -invoice.paidAt.getTime() });
      }
    }
    const fmt = (m: Map<string, number>) => [...m].map(([cur, sum]) => formatInvoiceAmount(sum, cur));
    const strip = ({ sort: _sort, ...rest }: DigestInvoice & { sort: number }): DigestInvoice => rest;
    overdue.sort((a, b) => a.sort - b.sort);
    paid.sort((a, b) => a.sort - b.sort);
    return {
      unpaidTotals: fmt(unpaid),
      unpaidCount,
      overdue: overdue.slice(0, 10).map(strip),
      overdueCount: overdue.length,
      paid: paid.slice(0, 10).map(strip),
      paidTotals: fmt(paidSums),
    };
  }
}

/** The deadlines this member picked for the dashboard tile, or the defaults for the company's VAT status. */
export function chosenTaxKinds(tiles: unknown, profile: TaxProfile): TaxDeadlineKind[] {
  const chosen = tiles && typeof tiles === "object" && !Array.isArray(tiles) ? (tiles as { taxDeadlines?: unknown }).taxDeadlines : null;
  return Array.isArray(chosen)
    ? chosen.filter((k): k is TaxDeadlineKind => (TAX_DEADLINE_KINDS as readonly string[]).includes(k as string))
    : defaultTaxDeadlineKinds(profile.vatStatus);
}
