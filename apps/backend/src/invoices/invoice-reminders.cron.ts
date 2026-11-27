import { Injectable, Logger, Optional } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { EmailService } from "../email/email.service";
import { NotificationsService } from "../notifications/notifications.service";
import { InvoiceRemindersRepository } from "./invoice-reminders.repository";
import { InvoicesService } from "./invoices.service";
import { computeInvoiceTotal, formatInvoiceAmount } from "./invoice-total.util";
import { amountLeftToPay, isRemindableDocument } from "./invoice-reminders.util";

/**
 * Daily overdue-payment-reminder digest, built on `invoices.public_token` /
 * `sent_at` / `last_reminder_sent_at` / `reminder_count` (added by the
 * client-portal/email-reminder schema-extension pass).
 *
 * `@Cron` (not BullMQ) is deliberate: the blueprint (§2) reserves
 * BullMQ/Redis for heavier async work that doesn't exist yet in this
 * scaffold (PDF/ISDOC generation, webhook retries, media processing) — a
 * once-a-day digest with no retry/backoff requirements doesn't need a
 * queue; `@nestjs/schedule`'s in-process cron is simpler and sufficient.
 */
@Injectable()
export class InvoiceRemindersCron {
  private readonly logger = new Logger(InvoiceRemindersCron.name);

  constructor(
    private readonly repository: InvoiceRemindersRepository,
    private readonly emailService: EmailService,
    @Optional() private readonly notifications?: NotificationsService,
    @Optional() private readonly invoices?: InvoicesService,
  ) {}

  /** Runs daily at 09:00 server time. */
  @Cron("0 9 * * *")
  async sendOverdueReminders(): Promise<void> {
    const tenantIds = await this.repository.listAllTenantIds();
    this.logger.log(`overdue-reminder sweep: scanning ${tenantIds.length} tenant(s)`);

    for (const tenantId of tenantIds) {
      const overdueInvoices = await this.repository.findOverdueInvoicesForTenant(tenantId);
      if (overdueInvoices.length === 0) continue;

      for (const { invoice, contactEmail, publicLink, clientPortalLink, lineItems, custom, credit } of overdueInvoices) {
        if (!contactEmail) {
          this.logger.warn(
            `invoice ${invoice.id} (tenant ${tenantId}) is overdue but its contact has no ` +
              "email on file – skipping reminder",
          );
          continue;
        }

        // The query already filters these; a reminder for a credit note or quote would ask for money that is not owed.
        if (!isRemindableDocument(invoice.documentType)) continue;
        // After a partial payment the reminder asks only for what is left.
        const left = amountLeftToPay(computeInvoiceTotal(lineItems, { reverseCharge: invoice.reverseCharge }), invoice.amountPaid);
        if (left <= 0) continue;

        try {
          // Suspended/paused companies and ones over today's cap get nothing sent; retried tomorrow.
          await this.repository.assertCanSend(tenantId);
          // The payment QR is a bonus: without it the reminder still goes out.
          const invoices = this.invoices;
          const paymentQr = invoices
            ? await this.repository.withTenant(tenantId, (db) => invoices.paymentQrFor(db, tenantId, invoice.id)).catch(() => null)
            : null;
          await this.emailService.sendPaymentReminderEmail(
            {
              to: contactEmail,
              invoiceNumber: invoice.invoiceNumber ?? invoice.id,
              amount: formatInvoiceAmount(left, invoice.currency),
              dueDate: invoice.dueDate,
              // Amount, due date, VS, QR and the link all work for an encrypted document: none of it is its text.
              variableSymbol: invoice.variableSymbol,
              paymentQr,
              publicLink,
              clientPortalLink,
              reminderCount: invoice.reminderCount + 1,
              language: invoice.language,
              documentType: invoice.documentType,
              credit,
              ...(custom ? { custom } : {}),
            },
            // Same key as the on-demand reminder: reminder #N goes out once, whoever asked first.
            { tenantId, idempotencyKey: `reminder:${invoice.id}:${invoice.reminderCount + 1}` },
          );
          await this.repository.recordReminderSent(tenantId, invoice.id, contactEmail);
          const link = `/invoices/${invoice.id}`;
          const no = invoice.invoiceNumber ?? "";
          if (invoice.reminderCount === 0) {
            this.notifications?.notify(tenantId, "invoice_overdue", { title: `Faktura ${no} je po splatnosti`, link });
          }
          this.notifications?.notify(tenantId, "reminder_sent", {
            title: `Automatická upomínka č. ${invoice.reminderCount + 1} k faktuře ${no}`,
            body: `Komu: ${contactEmail}`,
            link,
          });
        } catch (err) {
          // One invoice/tenant failing (e.g. a Resend outage) must not
          // abort the whole sweep — every other eligible invoice still gets
          // its reminder attempt today, and this one is retried tomorrow
          // (last_reminder_sent_at was never updated on failure).
          this.logger.error(
            `failed to send overdue reminder for invoice ${invoice.id} (tenant ${tenantId}): ` +
              `${(err as Error).message}`,
          );
        }
      }
    }
  }
}
