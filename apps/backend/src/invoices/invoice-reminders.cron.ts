import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { EmailService } from "../email/email.service";
import { InvoiceRemindersRepository } from "./invoice-reminders.repository";
import { computeInvoiceTotal, formatInvoiceAmount } from "./invoice-total.util";

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
  ) {}

  /** Runs daily at 09:00 server time. */
  @Cron("0 9 * * *")
  async sendOverdueReminders(): Promise<void> {
    const tenantIds = await this.repository.listAllTenantIds();
    this.logger.log(`overdue-reminder sweep: scanning ${tenantIds.length} tenant(s)`);

    for (const tenantId of tenantIds) {
      const overdueInvoices = await this.repository.findOverdueInvoicesForTenant(tenantId);

      for (const { invoice, contactEmail, lineItems } of overdueInvoices) {
        if (!contactEmail) {
          this.logger.warn(
            `invoice ${invoice.id} (tenant ${tenantId}) is overdue but its contact has no ` +
              "email on file — skipping reminder",
          );
          continue;
        }

        const total = computeInvoiceTotal(lineItems);

        try {
          await this.emailService.sendPaymentReminderEmail({
            to: contactEmail,
            invoiceNumber: invoice.invoiceNumber ?? invoice.id,
            amount: formatInvoiceAmount(total, invoice.currency),
            dueDate: invoice.dueDate,
            publicToken: invoice.publicToken,
            reminderCount: invoice.reminderCount + 1,
          });
          await this.repository.recordReminderSent(tenantId, invoice.id);
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
