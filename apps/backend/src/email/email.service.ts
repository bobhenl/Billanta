import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Resend } from "resend";

export interface SendInvoiceEmailParams {
  to: string;
  invoiceNumber: string;
  /** Pre-formatted for display, e.g. "1815.00 CZK" — see `invoice-total.util.ts`. */
  amount: string;
  dueDate: Date | null;
  /** `invoices.publicToken` — used to build the client-portal link. */
  publicToken: string;
}

export interface SendPaymentReminderEmailParams extends SendInvoiceEmailParams {
  /** 1-based — "this is reminder #N for this invoice." */
  reminderCount: number;
}

/**
 * Thin wrapper around Resend for the two transactional emails this backend
 * sends: "here is your invoice" (`InvoicesController`'s `POST .../:id/send`)
 * and "this invoice is overdue" (`InvoiceRemindersCron`, daily digest).
 *
 * Not part of the original blueprint §2 stack table — added for this
 * feature the same way `stripe` is a direct SDK dependency for billing.
 * Resend was chosen over Postmark/SES for MVP simplicity (simple API,
 * generous free tier, no AWS account/SES sandbox approval wait).
 *
 * ============================================================================
 * Confidence note on the Resend API shape used below — read before trusting
 * this blindly, same standard this codebase already holds `GopayClient` to.
 * ============================================================================
 * VERIFIED for real: `new Resend(apiKey)` and
 * `resend.emails.send({ from, to, subject, html })` returning
 * `{ data: { id: string } | null, error: { name, message, statusCode } | null,
 * headers }` — confirmed against the actual published type declarations of
 * `resend@6.26.0` (fetched from `https://unpkg.com/resend@6.26.0/dist/index.d.mts`
 * while writing this file), not recalled from memory or guessed.
 *
 * NOT verified: an actual live send against a real Resend account/domain —
 * no API key or network credential was available in this task, so delivery
 * behavior, domain-verification requirements, and rate limits are
 * unconfirmed in practice. Treat this as "real, type-correct integration
 * code against Resend's real SDK shape," not as "tested against production
 * Resend."
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly resend: Resend | null;
  private readonly fromAddress: string | undefined;

  constructor(config: ConfigService) {
    const apiKey = config.get<string>("RESEND_API_KEY");
    this.fromAddress = config.get<string>("EMAIL_FROM");
    // Constructed tolerant-of-missing-key rather than throwing at boot, so
    // the rest of the app (tests, local dev before Resend is configured)
    // doesn't hard-fail on startup — `send()` below fails loudly and
    // specifically the first time an actual send is attempted unconfigured.
    this.resend = apiKey ? new Resend(apiKey) : null;
  }

  async sendInvoiceEmail(params: SendInvoiceEmailParams): Promise<void> {
    const subject = `Faktura ${params.invoiceNumber}`;
    const html = renderInvoiceEmailHtml({
      heading: `Nová faktura ${params.invoiceNumber}`,
      intro: "Byla vám vystavena nová faktura. Podrobnosti a možnosti úhrady najdete níže.",
      invoiceNumber: params.invoiceNumber,
      amount: params.amount,
      dueDate: params.dueDate,
      publicToken: params.publicToken,
    });
    await this.send(params.to, subject, html);
  }

  async sendPaymentReminderEmail(params: SendPaymentReminderEmailParams): Promise<void> {
    const subject = `Upomínka: faktura ${params.invoiceNumber} je po splatnosti`;
    const html = renderInvoiceEmailHtml({
      heading: `Upomínka — faktura ${params.invoiceNumber} po splatnosti`,
      intro:
        params.reminderCount > 1
          ? `Toto je upomínka č. ${params.reminderCount} — faktura stále nebyla uhrazena.`
          : "Tato faktura je po splatnosti a podle našich záznamů dosud nebyla uhrazena.",
      invoiceNumber: params.invoiceNumber,
      amount: params.amount,
      dueDate: params.dueDate,
      publicToken: params.publicToken,
    });
    await this.send(params.to, subject, html);
  }

  private async send(to: string, subject: string, html: string): Promise<void> {
    if (!this.resend || !this.fromAddress) {
      throw new Error(
        "EmailService is not configured — RESEND_API_KEY and EMAIL_FROM must both be set " +
          "(see .env.example)",
      );
    }

    const { error } = await this.resend.emails.send({
      from: this.fromAddress,
      to,
      subject,
      html,
    });

    if (error) {
      throw new Error(`Resend send failed (${error.name}): ${error.message}`);
    }

    this.logger.log(`email sent to ${to}: ${subject}`);
  }
}

/**
 * Real (not placeholder) inline HTML template shared by both email kinds —
 * a dedicated templating engine is deliberately not introduced for two
 * emails this simple.
 *
 * The client-portal link is built from `NEXT_PUBLIC_SITE_URL` (already
 * defined in the root `.env.example` for the frontend's canonical origin —
 * see `apps/frontend/lib/site.ts` — reused here rather than inventing a
 * second site-URL env var) plus `/i/${publicToken}`, per this feature's
 * brief. No client-portal page at that route exists in the frontend yet
 * (that's a separate, concurrently-built module) — this is the URL contract
 * that page is expected to implement.
 */
function renderInvoiceEmailHtml(params: {
  heading: string;
  intro: string;
  invoiceNumber: string;
  amount: string;
  dueDate: Date | null;
  publicToken: string;
}): string {
  const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://faktur.app").replace(/\/$/, "");
  const portalUrl = `${siteUrl}/i/${params.publicToken}`;
  const dueDateFormatted = params.dueDate
    ? params.dueDate.toLocaleDateString("cs-CZ", { year: "numeric", month: "2-digit", day: "2-digit" })
    : "neuvedeno";

  return `<!doctype html>
<html lang="cs">
  <body style="font-family: -apple-system, Helvetica, Arial, sans-serif; background:#f4f5f7; margin:0; padding:24px;">
    <table role="presentation" width="100%" style="max-width:560px; margin:0 auto; background:#ffffff; border-radius:8px; overflow:hidden;">
      <tr>
        <td style="padding:32px;">
          <h1 style="font-size:20px; margin:0 0 16px; color:#111;">${escapeHtml(params.heading)}</h1>
          <p style="font-size:14px; color:#333; margin:0 0 24px; line-height:1.5;">${escapeHtml(params.intro)}</p>
          <table role="presentation" width="100%" style="font-size:14px; color:#333; margin-bottom:24px; border-collapse:collapse;">
            <tr>
              <td style="padding:6px 0; color:#666;">Číslo faktury</td>
              <td style="padding:6px 0; text-align:right;"><strong>${escapeHtml(params.invoiceNumber)}</strong></td>
            </tr>
            <tr>
              <td style="padding:6px 0; color:#666;">Částka</td>
              <td style="padding:6px 0; text-align:right;"><strong>${escapeHtml(params.amount)}</strong></td>
            </tr>
            <tr>
              <td style="padding:6px 0; color:#666;">Splatnost</td>
              <td style="padding:6px 0; text-align:right;">${escapeHtml(dueDateFormatted)}</td>
            </tr>
          </table>
          <p style="text-align:center; margin:0 0 8px;">
            <a href="${portalUrl}" style="display:inline-block; background:#111827; color:#ffffff; text-decoration:none; padding:12px 24px; border-radius:6px; font-size:14px;">Zobrazit fakturu</a>
          </p>
          <p style="font-size:12px; color:#999; text-align:center; margin-top:24px; word-break:break-all;">
            ${escapeHtml(portalUrl)}
          </p>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
