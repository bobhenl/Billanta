import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Resend } from "resend";
import { fillTemplate } from "../tenants/email-prefs";
import { clientPortalUrlOf, portalUrlOf } from "../tenants/template-vars";
import { escapeHtml, htmlToText } from "./email-render";
import { EmailOutboxService, type OutgoingEmail, type QueueContext } from "./email-outbox.service";

export interface SendInvoiceEmailParams {
  to: string;
  invoiceNumber: string;
  /** Pre-formatted for display, e.g. "1815.00 CZK" — see `invoice-total.util.ts`. */
  amount: string;
  dueDate: Date | null;
  /** The /i/ path segment from `invoiceLinkOf` (readable prefix + key), used to build the client-portal link. */
  publicLink: string;
  /** The /c/ segment from `clientPortalLinkOf` when the customer has the portal on; adds an "all your documents" link. */
  clientPortalLink?: string | null;
  /** The company's own wording, sender name and attachments (Settings → E-maily). */
  custom?: EmailCustomization;
  /** The customer already has this invoice and it was edited since: say it replaces the earlier copy. */
  corrected?: boolean;
}

export interface EmailAttachment {
  filename: string;
  content: Buffer;
  contentType?: string;
}

export interface EmailCustomization {
  subject?: string | null;
  message?: string | null;
  signature?: string | null;
  fromName?: string | null;
  replyTo?: string | null;
  bcc?: string | null;
  accent?: string;
  companyName?: string;
  customerName?: string;
  /** Settings → Proměnné plus the document's built-ins (`tenants/template-vars.ts`). */
  vars?: Record<string, string>;
  attachments?: EmailAttachment[];
}

interface SendOptions {
  fromName?: string | null;
  replyTo?: string | null;
  bcc?: string | null;
  attachments?: EmailAttachment[];
}

/** Where and how an e-mail is queued (see `QueueContext`); the key makes a retried action safe. */
export interface EmailQueueOptions extends QueueContext {
  idempotencyKey?: string;
  userId?: string | null;
}

/** A claimed outbox row, ready for Resend. */
export interface DeliverableEmail {
  id: string;
  recipient: string;
  fromName: string | null;
  replyTo: string | null;
  bcc: string | null;
  subject: string;
  html: string;
  textBody: string;
  headers: Record<string, string>;
  attachments: { filename: string; contentType?: string; content: string }[] | null;
}

export type DeliveryResult =
  | { ok: true; providerId: string | null }
  | { ok: false; statusCode: number | null; name: string; message: string };

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

  constructor(
    config: ConfigService,
    private readonly outbox: EmailOutboxService,
  ) {
    const apiKey = config.get<string>("RESEND_API_KEY");
    this.fromAddress = config.get<string>("EMAIL_FROM");
    // Constructed tolerant-of-missing-key rather than throwing at boot, so
    // the rest of the app (tests, local dev before Resend is configured)
    // doesn't hard-fail on startup. Everything is queued in the outbox
    // either way; the worker leaves it waiting while unconfigured.
    this.resend = apiKey ? new Resend(apiKey) : null;
  }

  isConfigured(): boolean {
    return Boolean(this.resend && this.fromAddress);
  }

  async sendInvoiceEmail(params: SendInvoiceEmailParams, queue: EmailQueueOptions): Promise<void> {
    const values = placeholderValues(params);
    const c = params.custom;
    const custom = c?.subject ? fillTemplate(c.subject, values) : null;
    const subject = params.corrected
      ? custom
        ? `Oprava: ${custom}`
        : `Opravená faktura ${params.invoiceNumber}`
      : (custom ?? `Faktura ${params.invoiceNumber}`);
    const correctedNote = "Posíláme opravenou verzi faktury, kterou jste od nás už dostali. Předchozí verzi prosím nahraďte touto.";
    const html = renderInvoiceEmailHtml({
      heading: params.corrected ? `Opravená faktura ${params.invoiceNumber}` : `Nová faktura ${params.invoiceNumber}`,
      intro: c?.message
        ? (params.corrected ? `${correctedNote}

` : "") + fillTemplate(c.message, values)
        : params.corrected
          ? correctedNote
          : "Byla vám vystavena nová faktura. Podrobnosti a možnosti úhrady najdete níže.",
      invoiceNumber: params.invoiceNumber,
      amount: params.amount,
      dueDate: params.dueDate,
      publicLink: params.publicLink,
      clientPortalLink: params.clientPortalLink,
      signature: c?.signature ? fillTemplate(c.signature, values) : undefined,
      accent: c?.accent,
      attachmentNames: c?.attachments?.map((a) => a.filename),
    });
    await this.queue({ kind: "invoice", category: "transactional", to: params.to, subject, html, ...sendOptions(c) }, queue);
  }

  async sendPaymentReminderEmail(params: SendPaymentReminderEmailParams, queue: EmailQueueOptions): Promise<void> {
    const values = { ...placeholderValues(params), reminder_no: String(params.reminderCount) };
    const c = params.custom;
    const subject = c?.subject
      ? fillTemplate(c.subject, values)
      : `Upomínka: faktura ${params.invoiceNumber} je po splatnosti`;
    const html = renderInvoiceEmailHtml({
      heading: `Upomínka – faktura ${params.invoiceNumber} po splatnosti`,
      intro: c?.message
        ? fillTemplate(c.message, values)
        : params.reminderCount > 1
          ? `Toto je upomínka č. ${params.reminderCount} – faktura stále nebyla uhrazena.`
          : "Tato faktura je po splatnosti a podle našich záznamů dosud nebyla uhrazena.",
      invoiceNumber: params.invoiceNumber,
      amount: params.amount,
      dueDate: params.dueDate,
      publicLink: params.publicLink,
      clientPortalLink: params.clientPortalLink,
      signature: c?.signature ? fillTemplate(c.signature, values) : undefined,
      accent: c?.accent,
      attachmentNames: c?.attachments?.map((a) => a.filename),
    });
    await this.queue({ kind: "reminder", category: "transactional", to: params.to, subject, html, ...sendOptions(c) }, queue);
  }

  /**
   * A security alert to a member (payout account changed, …): goes out at
   * once, ignores quiet hours and preferences, no unsubscribe link. Ordinary
   * notifications go through `EmailOutboxService.enqueueNotification` instead.
   */
  async sendSecurityAlertEmail(params: { to: string; title: string; body?: string | null; url?: string | null }, queue: EmailQueueOptions) {
    await this.queue(
      { kind: "security_alert", category: "transactional", to: params.to, subject: params.title, html: simpleMessageHtml(params) },
      queue,
    );
  }

  /** Trial ending, plan paid: to owners and admins, transactional like a security alert. */
  async sendBillingNoticeEmail(params: { to: string; title: string; body?: string | null; url?: string | null }, queue: EmailQueueOptions) {
    await this.queue(
      { kind: "billing_notice", category: "transactional", to: params.to, subject: params.title, html: simpleMessageHtml(params) },
      queue,
    );
  }

  /**
   * Billanta's own mail to staff (abuse reports): there is no tenant, so no
   * outbox. Sent directly when Resend is configured, otherwise only logged.
   */
  async sendPlatformEmail(params: { to: string; title: string; body?: string | null }) {
    if (!this.resend || !this.fromAddress) {
      this.logger.warn(`E-mail is not configured, staff e-mail "${params.title}" not sent`);
      return;
    }
    const html = simpleMessageHtml(params);
    const { error } = await this.resend.emails.send({ from: this.fromAddress, to: params.to, subject: params.title, html, text: htmlToText(html) });
    if (error) throw new Error(`Resend send failed (${error.name}): ${error.message}`);
  }

  /** "Doplňte prosím své fakturační údaje" – the buyer-details link for a draft (BuyerDetailsService). */
  async sendBuyerDetailsRequestEmail(
    params: { to: string; companyName: string; amount: string; url: string; replyTo?: string | null },
    queue: EmailQueueOptions,
  ) {
    const html = `<!doctype html><html lang="cs"><body style="font-family:Arial,sans-serif;background:#f6f7f9;padding:24px;">
      <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;padding:28px;">
        <h1 style="font-size:18px;margin:0 0 12px;color:#111;">Doplňte prosím své fakturační údaje</h1>
        <p style="color:#374151;line-height:1.5;margin:0 0 12px;"><strong>${escapeHtml(params.companyName)}</strong> pro vás připravuje fakturu na
          <strong>${escapeHtml(params.amount)}</strong>. Aby byla vystavená správně, vyplňte prosím, na koho má znít –
          název nebo jméno, adresu a případně IČO a DIČ. Zabere to minutu.</p>
        <p style="margin:20px 0;"><a href="${escapeHtml(params.url)}" style="display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-size:14px;">Doplnit údaje</a></p>
        <p style="color:#9ca3af;font-size:12px;word-break:break-all;">${escapeHtml(params.url)}</p>
        <p style="color:#9ca3af;font-size:12px;margin-top:16px;">Pokud jste nic neobjednávali, e-mail ignorujte.</p>
      </div></body></html>`;
    await this.queue(
      {
        kind: "buyer_details_request",
        category: "transactional",
        to: params.to,
        subject: `Doplňte prosím fakturační údaje pro ${params.companyName}`,
        html,
        fromName: params.companyName,
        replyTo: params.replyTo ?? null,
      },
      queue,
    );
  }

  /** "You've been invited to <company> on Billanta" — Settings → Team. */
  async sendInvitationEmail(params: { to: string; companyName: string; role: string; acceptUrl: string }, queue: EmailQueueOptions) {
    const esc = (v: string) =>
      v.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
    const html = `<!doctype html><html><body style="font-family:Arial,sans-serif;background:#f6f7f9;padding:24px;">
      <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;padding:32px;">
        <h1 style="font-size:20px;margin:0 0 16px;color:#111;">Pozvánka do ${esc(params.companyName)}</h1>
        <p style="color:#374151;line-height:1.5;">Byli jste pozváni do firmy <strong>${esc(params.companyName)}</strong>
          v aplikaci Billanta s rolí <strong>${esc(params.role)}</strong>. Pozvánka platí 7 dní.</p>
        <p style="margin:24px 0;"><a href="${esc(params.acceptUrl)}" style="display:inline-block;background:#4f46e5;color:#fff;
          text-decoration:none;padding:12px 24px;border-radius:8px;font-size:14px;">Přijmout pozvánku</a></p>
        <p style="color:#6b7280;font-size:12px;">Pokud jste pozvánku nečekali, e-mail ignorujte.</p>
      </div></body></html>`;
    await this.queue(
      { kind: "team_invitation", category: "transactional", to: params.to, subject: `Pozvánka do ${params.companyName} (Billanta)`, html },
      queue,
    );
  }

  private async queue(email: OutgoingEmail, queue: EmailQueueOptions): Promise<void> {
    await this.outbox.enqueue(
      { ...email, userId: queue.userId ?? null, ...(queue.idempotencyKey ? { idempotencyKey: queue.idempotencyKey } : {}) },
      { tenantId: queue.tenantId, db: queue.db },
    );
  }

  /**
   * One delivery attempt for a claimed outbox row (`EmailOutboxWorker`).
   * The row id is Resend's idempotency key, so a retry after a timeout whose
   * send actually went through doesn't mail the customer twice.
   */
  async deliver(row: DeliverableEmail): Promise<DeliveryResult> {
    if (!this.resend || !this.fromAddress) {
      return { ok: false, statusCode: null, name: "not_configured", message: "RESEND_API_KEY and EMAIL_FROM must both be set" };
    }
    try {
      const { data, error } = await this.resend.emails.send(
        {
          from: withDisplayName(this.fromAddress, row.fromName),
          to: row.recipient,
          subject: row.subject,
          html: row.html,
          text: row.textBody,
          ...(Object.keys(row.headers ?? {}).length ? { headers: row.headers } : {}),
          ...(row.replyTo ? { replyTo: row.replyTo } : {}),
          ...(row.bcc ? { bcc: row.bcc } : {}),
          ...(row.attachments?.length
            ? { attachments: row.attachments.map((a) => ({ filename: a.filename, content: a.content, contentType: a.contentType })) }
            : {}),
        },
        { idempotencyKey: `outbox-${row.id}` },
      );
      if (error) return { ok: false, statusCode: error.statusCode ?? null, name: error.name, message: error.message };
      return { ok: true, providerId: data?.id ?? null };
    } catch (err) {
      // Network failure or timeout: worth another attempt.
      return { ok: false, statusCode: null, name: "network_error", message: err instanceof Error ? err.message : String(err) };
    }
  }
}

function sendOptions(c: SendOptions | undefined): Pick<OutgoingEmail, "fromName" | "replyTo" | "bcc" | "attachments"> {
  return { fromName: c?.fromName ?? null, replyTo: c?.replyTo ?? null, bcc: c?.bcc ?? null, attachments: c?.attachments };
}

function simpleMessageHtml(params: { title: string; body?: string | null; url?: string | null }): string {
  return `<!doctype html><html lang="cs"><body style="font-family:Arial,sans-serif;background:#f6f7f9;padding:24px;">
      <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;padding:28px;">
        <h1 style="font-size:18px;margin:0 0 12px;color:#111;">${escapeHtml(params.title)}</h1>
        ${params.body ? `<p style="color:#374151;line-height:1.5;margin:0 0 20px;">${escapeHtml(params.body)}</p>` : ""}
        ${params.url ? `<p><a href="${escapeHtml(params.url)}" style="display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;padding:10px 20px;border-radius:8px;font-size:14px;">Otevřít v Billantě</a></p>` : ""}
      </div></body></html>`;
}

/**
 * Real (not placeholder) inline HTML template shared by both email kinds —
 * a dedicated templating engine is deliberately not introduced for two
 * emails this simple.
 *
 * The client-portal link is built from `NEXT_PUBLIC_SITE_URL` (already
 * defined in the root `.env.example` for the frontend's canonical origin —
 * see `apps/frontend/lib/site.ts` — reused here rather than inventing a
 * second site-URL env var) plus `/i/${publicLink}`, per this feature's
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
  publicLink: string;
  clientPortalLink?: string | null;
  signature?: string;
  accent?: string;
  attachmentNames?: string[];
}): string {
  const portalUrl = portalUrlOf(params.publicLink);
  const accent = params.accent && /^#[0-9a-fA-F]{6}$/.test(params.accent) ? params.accent : "#111827";
  const paragraphs = (text: string) => escapeHtml(text).replace(/\r?\n/g, "<br>");
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
          <p style="font-size:14px; color:#333; margin:0 0 24px; line-height:1.5;">${paragraphs(params.intro)}</p>
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
            <a href="${portalUrl}" style="display:inline-block; background:${accent}; color:#ffffff; text-decoration:none; padding:12px 24px; border-radius:6px; font-size:14px;">Zobrazit fakturu</a>
          </p>
          ${
            params.clientPortalLink
              ? `<p style="text-align:center; font-size:13px; margin:12px 0 0;"><a href="${clientPortalUrlOf(params.clientPortalLink)}" style="color:${accent};">Všechny vaše doklady na jednom místě</a></p>`
              : ""
          }
          ${
            params.attachmentNames?.length
              ? `<p style="font-size:13px; color:#555; margin:20px 0 0;">Přílohy: ${params.attachmentNames.map(escapeHtml).join(", ")}</p>`
              : ""
          }
          ${params.signature ? `<p style="font-size:14px; color:#333; margin:20px 0 0; line-height:1.5;">${paragraphs(params.signature)}</p>` : ""}
          <p style="font-size:12px; color:#999; text-align:center; margin-top:24px; word-break:break-all;">
            ${escapeHtml(portalUrl)}
          </p>
          <p style="font-size:11px; color:#aaa; text-align:center; margin-top:8px;">
            Nečekali jste tento doklad? <a href="${portalUrl}?report=1" style="color:#888;">Nahlaste ho</a>.
          </p>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}


function placeholderValues(params: SendInvoiceEmailParams): Record<string, string> {
  return {
    ...params.custom?.vars,
    number: params.invoiceNumber,
    amount: params.amount,
    due_date: params.dueDate
      ? params.dueDate.toLocaleDateString("cs-CZ", { year: "numeric", month: "2-digit", day: "2-digit" })
      : "",
    company: params.custom?.companyName ?? "",
    customer: params.custom?.customerName ?? "",
    link: portalUrlOf(params.publicLink),
    portal_link: params.clientPortalLink ? clientPortalUrlOf(params.clientPortalLink) : "",
  };
}

/** `"Novák Design" <faktury@billanta.cz>` from `EMAIL_FROM` (either `addr` or `Name <addr>`). */
export function withDisplayName(from: string, name?: string | null): string {
  const clean = name?.replace(/["<>\r\n]/g, "").trim();
  if (!clean) return from;
  const address = from.match(/<([^>]+)>/)?.[1] ?? from.trim();
  return `"${clean}" <${address}>`;
}
