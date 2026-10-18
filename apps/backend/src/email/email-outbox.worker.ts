import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { DbService } from "../db/db.service";
import { EmailService, type DeliverableEmail } from "./email.service";
import { classifySendError, nextStepAfterFailure, OUTBOX } from "./outbox-policy";

interface ClaimedRow {
  id: string;
  /** Null for account e-mails queued by the frontend (migration 0059). */
  tenant_id: string | null;
  kind: string;
  recipient: string;
  from_name: string | null;
  reply_to: string | null;
  bcc: string | null;
  subject: string;
  html: string;
  text_body: string;
  headers: Record<string, string> | null;
  attachments: DeliverableEmail["attachments"];
  attempts: number;
  max_attempts: number;
}

/**
 * Delivers `email_outbox` once a minute. Cron rather than a queue for the
 * same reason as `InvoiceRemindersCron`: one process, modest volume, and the
 * table itself is the durable queue. Rows are claimed and finished through
 * SECURITY DEFINER functions (migration 0049) because the worker has no
 * tenant context. Without RESEND_API_KEY nothing is claimed: mail waits and
 * expires after `EMAIL_OUTBOX_MAX_AGE_HOURS`, and nothing is ever sent.
 */
@Injectable()
export class EmailOutboxWorker {
  private readonly logger = new Logger(EmailOutboxWorker.name);
  private running = false;
  private warnedUnconfigured = false;

  constructor(
    private readonly dbService: DbService,
    private readonly email: EmailService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.drain();
    } catch (err) {
      this.logger.error(`outbox tick failed: ${err instanceof Error ? err.message : err}`);
    } finally {
      this.running = false;
    }
  }

  /** One pass over due mail; returns how many rows were attempted. */
  async drain(now = () => new Date()): Promise<number> {
    if (!this.email.isConfigured()) {
      if (!this.warnedUnconfigured) {
        this.logger.warn("RESEND_API_KEY/EMAIL_FROM not set: queued e-mail is kept in the outbox and not sent");
        this.warnedUnconfigured = true;
      }
      return 0;
    }
    this.warnedUnconfigured = false;
    const rows = await this.dbService.sql<ClaimedRow[]>`
      SELECT * FROM claim_email_outbox(${OUTBOX.batchSize}, ${OUTBOX.lockSeconds}, ${OUTBOX.maxAgeHours})`;
    for (const row of rows) await this.attempt(row, now());
    return rows.length;
  }

  private async attempt(row: ClaimedRow, now: Date) {
    const result = await this.email.deliver({
      id: row.id,
      recipient: row.recipient,
      fromName: row.from_name,
      replyTo: row.reply_to,
      bcc: row.bcc,
      subject: row.subject,
      html: row.html,
      textBody: row.text_body,
      headers: row.headers ?? {},
      attachments: row.attachments,
    });
    if (result.ok) {
      await this.finish(row.id, "sent", result.providerId, null, null);
      this.logger.log(`e-mail ${row.kind} ${row.id} sent`);
      return;
    }
    const failure = classifySendError(result);
    const step = nextStepAfterFailure(row.attempts, row.max_attempts, failure, now);
    await this.finish(row.id, step.outcome, null, failure.reason, step.retryAt);
    const msg = `e-mail ${row.kind} ${row.id} attempt ${row.attempts}/${row.max_attempts} failed (${failure.reason})`;
    if (step.outcome === "dead") this.logger.error(`${msg}: giving up`);
    else this.logger.warn(`${msg}: retry at ${step.retryAt!.toISOString()}`);
  }

  private async finish(id: string, outcome: "sent" | "retry" | "dead", providerId: string | null, error: string | null, retryAt: Date | null) {
    await this.dbService.sql`SELECT finish_email_outbox(${id}, ${outcome}, ${providerId}, ${error}, ${retryAt?.toISOString() ?? null}::timestamptz)`;
  }
}
