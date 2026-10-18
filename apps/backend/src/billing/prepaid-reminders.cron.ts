import { ConflictException, Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { and, desc, eq, sql } from "drizzle-orm";
import QRCode from "qrcode";
import * as schema from "../../drizzle/schema";
import { DbService } from "../db/db.service";
import { drizzleTx } from "../db/drizzle-tx";
import type { EmailAttachment } from "../email/email.service";
import { NotificationsService, type NotificationPayload } from "../notifications/notifications.service";
import { platformBillingEntity, proformaSpayd, type ProformaMonths } from "./bank-transfer";
import { prepaidReminderMessage } from "./billing-messages";
import { prepaidReminderDue } from "./plan-access";
import { isPaidPlan } from "./plans";
import { SubscriptionService } from "./subscription.service";

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(isoDay: string, n: number): string {
  return new Date(Date.parse(`${isoDay}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

/**
 * A period paid by bank transfer doesn't renew, so 14 and 3 days before
 * `prepaid_until` the owners and admins get an e-mail (and the bell) with a
 * proforma for the next period: the same plan and length as the last paid
 * one, its payment details and the QR Platba code as an attachment. An
 * unpaid proforma for that plan is reused, so the 3-day e-mail repeats the
 * 14-day one's payment instead of issuing a second. A company that has
 * meanwhile switched to a card subscription gets nothing.
 *
 * Same cross-tenant pattern and the same "record the stage first" rule as
 * `TrialRemindersCron`: a failed e-mail is not retried by this job (the
 * outbox retries delivery), but nobody is told the same thing twice.
 */
@Injectable()
export class PrepaidRemindersCron {
  private readonly logger = new Logger(PrepaidRemindersCron.name);

  constructor(
    private readonly dbService: DbService,
    private readonly notifications: NotificationsService,
    private readonly subscriptions: SubscriptionService,
  ) {}

  @Cron("15 8 * * *", { timeZone: "Europe/Prague" })
  async run(now = new Date()): Promise<number> {
    const payee = platformBillingEntity();
    // Nothing to pay to; the company sees the end date in the panel anyway.
    if (!payee) return 0;
    const today = isoDay(now);
    const rows = await this.dbService.db.execute<{ tenant_id: string }>(sql`SELECT * FROM list_tenant_ids() AS t(tenant_id)`);
    let sent = 0;
    for (const { tenant_id: tenantId } of rows) {
      try {
        // Filled inside the transaction, sent after it commits. A holder object
        // because TS cannot see the closure assign a plain `let`.
        const pending: { out: { notice: NotificationPayload; lang: string; details: { label: string; value: string }[]; attachments: EmailAttachment[]; key: string } | null } =
          { out: null };
        await this.dbService.sql.begin(async (tx) => {
          await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;
          const db = drizzleTx(tx, schema);
          const [t] = await db.select().from(schema.tenants).where(eq(schema.tenants.id, tenantId));
          if (!t?.prepaidUntil || !isPaidPlan(t.prepaidPlan)) return;
          const plan = t.prepaidPlan;
          const subscriptionLive =
            isPaidPlan(t.subscriptionPlan) && (t.subscriptionStatus === "active" || t.subscriptionStatus === "past_due");
          const stage = prepaidReminderDue(
            { prepaidUntil: t.prepaidUntil, subscriptionLive },
            { until: t.prepaidReminderUntil, days: t.prepaidRemindedDays },
            today,
          );
          if (stage === null) return;

          const proforma = await this.renewalProforma(db, tenantId, plan, t.prepaidUntil, today);
          if (!proforma) return;
          await db
            .update(schema.tenants)
            .set({ prepaidReminderUntil: t.prepaidUntil, prepaidRemindedDays: stage })
            .where(eq(schema.tenants.id, tenantId));

          const daysLeft = Math.round((Date.parse(`${t.prepaidUntil}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
          const message = prepaidReminderMessage(t.defaultLocale, plan, t.prepaidUntil, daysLeft, {
            ...proforma,
            account: payee.account,
            iban: payee.iban,
          });
          const qr = await QRCode.toBuffer(proformaSpayd(payee, proforma), { margin: 1, width: 300 });
          pending.out = {
            notice: message.notice,
            lang: message.lang,
            details: message.details,
            attachments: [{ filename: `qr-platba-${proforma.number}.png`, content: qr, contentType: "image/png" }],
            key: `prepaid_reminder:${t.prepaidUntil}:${stage}`,
          };
        });
        const o = pending.out;
        if (o) {
          await this.notifications.deliverBilling(tenantId, o.notice, {
            lang: o.lang,
            details: o.details,
            attachments: o.attachments,
            idempotencyKey: o.key,
          });
          sent += 1;
        }
      } catch (err) {
        this.logger.error(`prepaid reminder failed for tenant ${tenantId}: ${(err as Error).message}`);
      }
    }
    if (sent > 0) this.logger.log(`prepaid reminders: ${sent} sent`);
    return sent;
  }

  /**
   * The unpaid proforma for `plan`, else a new one for as long as the last
   * paid one covered (a month when the period came from credits). Due on the
   * period's last day, so the plan carries on without a gap, but never in
   * fewer than three days.
   */
  private async renewalProforma(db: Parameters<SubscriptionService["proformas"]>[0], tenantId: string, plan: string, until: string, today: string) {
    const pending = async (forPlan: boolean) => {
      const [p] = await db
        .select()
        .from(schema.platformProformas)
        .where(
          and(
            eq(schema.platformProformas.tenantId, tenantId),
            eq(schema.platformProformas.status, "pending"),
            ...(forPlan ? [eq(schema.platformProformas.plan, plan)] : []),
          ),
        )
        .orderBy(desc(schema.platformProformas.createdAt))
        .limit(1);
      return p ?? null;
    };
    const open = await pending(true);
    if (open) return open;
    if (!isPaidPlan(plan)) return null;
    const [last] = await db
      .select({ months: schema.platformProformas.months })
      .from(schema.platformProformas)
      .where(
        and(
          eq(schema.platformProformas.tenantId, tenantId),
          eq(schema.platformProformas.status, "paid"),
          eq(schema.platformProformas.plan, plan),
        ),
      )
      .orderBy(desc(schema.platformProformas.paidAt))
      .limit(1);
    const months: ProformaMonths = last?.months === 12 ? 12 : 1;
    const soonest = addDays(today, 3);
    const dueDate = until > soonest ? until : soonest;
    try {
      await this.subscriptions.requestProforma(db, tenantId, undefined, plan, months, { dueDate });
    } catch (err) {
      // Three unpaid proformas already (other plans): point at the newest of them.
      if (err instanceof ConflictException) return pending(false);
      throw err;
    }
    return pending(true);
  }
}
