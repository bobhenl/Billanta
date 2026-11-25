import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Resend } from "resend";
import { fillTemplate } from "../tenants/email-prefs";
import { clientPortalUrlOf, portalUrlOf } from "../tenants/template-vars";
import { escapeHtml, htmlToText } from "./email-render";
import { EmailOutboxService, type OutgoingEmail, type QueueContext } from "./email-outbox.service";
import type { BrandCredit } from "../invoices/brand-credit";

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
  /** The "Vystaveno v Billantě" line under the card; null when the company switched it off (invoices/brand-credit.ts). */
  credit?: BrandCredit | null;
  /** The document's language (`invoices.language`); the customer reads the e-mail in it. Defaults to Czech. */
  language?: string | null;
  /** `invoices.document_type`; a credit note gets its own wording, since it asks for no payment. */
  documentType?: string | null;
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
    const lang = emailLangOf(params.language);
    const l = EMAIL_LABELS[lang];
    const creditNote = params.documentType === "credit_note";
    const n = params.invoiceNumber;
    const values = placeholderValues(params);
    const c = params.custom;
    const custom = c?.subject ? fillTemplate(c.subject, values) : null;
    const subject = params.corrected
      ? custom
        ? `${l.correctionPrefix} ${custom}`
        : l.correctedSubject(n)
      : (custom ?? (creditNote ? l.creditNoteSubject(n) : l.invoiceSubject(n)));
    const html = renderInvoiceEmailHtml({
      lang,
      creditNote,
      heading: params.corrected ? l.correctedSubject(n) : creditNote ? l.creditNoteSubject(n) : l.invoiceHeading(n),
      intro: c?.message
        ? (params.corrected ? `${l.correctedNote}

` : "") + fillTemplate(c.message, values)
        : params.corrected
          ? l.correctedNote
          : creditNote
            ? l.creditNoteIntro
            : l.invoiceIntro,
      invoiceNumber: params.invoiceNumber,
      amount: params.amount,
      dueDate: params.dueDate,
      publicLink: params.publicLink,
      clientPortalLink: params.clientPortalLink,
      signature: c?.signature ? fillTemplate(c.signature, values) : undefined,
      accent: c?.accent,
      attachmentNames: c?.attachments?.map((a) => a.filename),
      credit: params.credit,
    });
    await this.queue({ kind: "invoice", category: "transactional", to: params.to, subject, html, ...sendOptions(c) }, queue);
  }

  async sendPaymentReminderEmail(params: SendPaymentReminderEmailParams, queue: EmailQueueOptions): Promise<void> {
    const lang = emailLangOf(params.language);
    const l = EMAIL_LABELS[lang];
    const values = { ...placeholderValues(params), reminder_no: String(params.reminderCount) };
    const c = params.custom;
    const subject = c?.subject ? fillTemplate(c.subject, values) : l.reminderSubject(params.invoiceNumber);
    const html = renderInvoiceEmailHtml({
      lang,
      creditNote: false,
      heading: l.reminderHeading(params.invoiceNumber),
      intro: c?.message
        ? fillTemplate(c.message, values)
        : params.reminderCount > 1
          ? l.reminderAgain(params.reminderCount)
          : l.reminderFirst,
      invoiceNumber: params.invoiceNumber,
      amount: params.amount,
      dueDate: params.dueDate,
      publicLink: params.publicLink,
      clientPortalLink: params.clientPortalLink,
      signature: c?.signature ? fillTemplate(c.signature, values) : undefined,
      accent: c?.accent,
      attachmentNames: c?.attachments?.map((a) => a.filename),
      credit: params.credit,
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

  /**
   * Trial ending, plan paid, prepaid period ending: to owners and admins,
   * transactional like a security alert. `details` is a label/value table
   * (payment details for a renewal proforma), `attachments` its QR code.
   */
  async sendBillingNoticeEmail(
    params: {
      to: string;
      title: string;
      body?: string | null;
      url?: string | null;
      lang?: string;
      details?: BillingNoticeDetail[];
      attachments?: EmailAttachment[];
    },
    queue: EmailQueueOptions,
  ) {
    await this.queue(
      {
        kind: "billing_notice",
        category: "transactional",
        to: params.to,
        subject: params.title,
        html: simpleMessageHtml(params),
        ...(params.attachments?.length ? { attachments: params.attachments } : {}),
      },
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

export interface BillingNoticeDetail {
  label: string;
  value: string;
}

const OPEN_IN_APP: Record<string, string> = { cs: "Otevřít v Billantě", sk: "Otvoriť v Billante", en: "Open in Billanta" };

function simpleMessageHtml(params: { title: string; body?: string | null; url?: string | null; lang?: string; details?: BillingNoticeDetail[] }): string {
  const lang = params.lang === "sk" || params.lang === "en" ? params.lang : "cs";
  const rows = (params.details ?? [])
    .map(
      (d) =>
        `<tr><td style="color:#6b7280;padding:4px 16px 4px 0;vertical-align:top;">${escapeHtml(d.label)}</td><td style="color:#111;padding:4px 0;font-weight:bold;">${escapeHtml(d.value)}</td></tr>`,
    )
    .join("");
  return `<!doctype html><html lang="${lang}"><body style="font-family:Arial,sans-serif;background:#f6f7f9;padding:24px;">
      <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;padding:28px;">
        <h1 style="font-size:18px;margin:0 0 12px;color:#111;">${escapeHtml(params.title)}</h1>
        ${params.body ? `<p style="color:#374151;line-height:1.5;margin:0 0 20px;">${escapeHtml(params.body)}</p>` : ""}
        ${rows ? `<table style="font-size:14px;border-collapse:collapse;margin:0 0 20px;">${rows}</table>` : ""}
        ${params.url ? `<p><a href="${escapeHtml(params.url)}" style="display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;padding:10px 20px;border-radius:8px;font-size:14px;">${OPEN_IN_APP[lang]}</a></p>` : ""}
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
type EmailLang = "cs" | "sk" | "en";

function emailLangOf(language: string | null | undefined): EmailLang {
  return language === "sk" || language === "en" ? language : "cs";
}

/** Wording of the invoice and reminder e-mails per document language. */
const EMAIL_LABELS: Record<
  EmailLang,
  {
    invoiceSubject: (n: string) => string;
    invoiceHeading: (n: string) => string;
    invoiceIntro: string;
    creditNoteSubject: (n: string) => string;
    creditNoteIntro: string;
    correctedSubject: (n: string) => string;
    correctionPrefix: string;
    correctedNote: string;
    reminderSubject: (n: string) => string;
    reminderHeading: (n: string) => string;
    reminderFirst: string;
    reminderAgain: (count: number) => string;
    invoiceNumber: string;
    documentNumber: string;
    amount: string;
    dueDate: string;
    notStated: string;
    viewInvoice: string;
    viewDocument: string;
    allDocuments: string;
    attachments: string;
    unexpected: string;
    report: string;
    dateLocale: string;
  }
> = {
  cs: {
    invoiceSubject: (n) => `Faktura ${n}`,
    invoiceHeading: (n) => `Nová faktura ${n}`,
    invoiceIntro: "Byla vám vystavena nová faktura. Podrobnosti a možnosti úhrady najdete níže.",
    creditNoteSubject: (n) => `Opravný daňový doklad ${n}`,
    creditNoteIntro: "Posíláme vám opravný daňový doklad, který snižuje částku původní faktury. Podrobnosti najdete níže.",
    correctedSubject: (n) => `Opravená faktura ${n}`,
    correctionPrefix: "Oprava:",
    correctedNote: "Posíláme opravenou verzi faktury, kterou jste od nás už dostali. Předchozí verzi prosím nahraďte touto.",
    reminderSubject: (n) => `Upomínka: faktura ${n} je po splatnosti`,
    reminderHeading: (n) => `Upomínka – faktura ${n} po splatnosti`,
    reminderFirst: "Tato faktura je po splatnosti a podle našich záznamů dosud nebyla uhrazena.",
    reminderAgain: (count) => `Toto je upomínka č. ${count} – faktura stále nebyla uhrazena.`,
    invoiceNumber: "Číslo faktury",
    documentNumber: "Číslo dokladu",
    amount: "Částka",
    dueDate: "Splatnost",
    notStated: "neuvedeno",
    viewInvoice: "Zobrazit fakturu",
    viewDocument: "Zobrazit doklad",
    allDocuments: "Všechny vaše doklady na jednom místě",
    attachments: "Přílohy",
    unexpected: "Nečekali jste tento doklad?",
    report: "Nahlaste ho",
    dateLocale: "cs-CZ",
  },
  sk: {
    invoiceSubject: (n) => `Faktúra ${n}`,
    invoiceHeading: (n) => `Nová faktúra ${n}`,
    invoiceIntro: "Bola vám vystavená nová faktúra. Podrobnosti a možnosti úhrady nájdete nižšie.",
    creditNoteSubject: (n) => `Dobropis ${n}`,
    creditNoteIntro: "Posielame vám dobropis, ktorý znižuje sumu pôvodnej faktúry. Podrobnosti nájdete nižšie.",
    correctedSubject: (n) => `Opravená faktúra ${n}`,
    correctionPrefix: "Oprava:",
    correctedNote: "Posielame opravenú verziu faktúry, ktorú ste od nás už dostali. Predchádzajúcu verziu, prosím, nahraďte touto.",
    reminderSubject: (n) => `Upomienka: faktúra ${n} je po splatnosti`,
    reminderHeading: (n) => `Upomienka – faktúra ${n} po splatnosti`,
    reminderFirst: "Táto faktúra je po splatnosti a podľa našich záznamov ešte nebola uhradená.",
    reminderAgain: (count) => `Toto je upomienka č. ${count} – faktúra stále nebola uhradená.`,
    invoiceNumber: "Číslo faktúry",
    documentNumber: "Číslo dokladu",
    amount: "Suma",
    dueDate: "Splatnosť",
    notStated: "neuvedená",
    viewInvoice: "Zobraziť faktúru",
    viewDocument: "Zobraziť doklad",
    allDocuments: "Všetky vaše doklady na jednom mieste",
    attachments: "Prílohy",
    unexpected: "Nečakali ste tento doklad?",
    report: "Nahláste ho",
    dateLocale: "sk-SK",
  },
  en: {
    invoiceSubject: (n) => `Invoice ${n}`,
    invoiceHeading: (n) => `New invoice ${n}`,
    invoiceIntro: "A new invoice has been issued to you. You will find the details and payment options below.",
    creditNoteSubject: (n) => `Credit note ${n}`,
    creditNoteIntro: "We are sending you a credit note that reduces the amount of the original invoice. You will find the details below.",
    correctedSubject: (n) => `Corrected invoice ${n}`,
    correctionPrefix: "Correction:",
    correctedNote: "This is a corrected version of an invoice you already received from us. Please replace the earlier version with this one.",
    reminderSubject: (n) => `Reminder: invoice ${n} is overdue`,
    reminderHeading: (n) => `Reminder – invoice ${n} is overdue`,
    reminderFirst: "This invoice is past its due date and according to our records has not been paid yet.",
    reminderAgain: (count) => `This is reminder no. ${count} – the invoice has still not been paid.`,
    invoiceNumber: "Invoice number",
    documentNumber: "Document number",
    amount: "Amount",
    dueDate: "Due date",
    notStated: "not stated",
    viewInvoice: "View invoice",
    viewDocument: "View document",
    allDocuments: "All your documents in one place",
    attachments: "Attachments",
    unexpected: "Didn't expect this document?",
    report: "Report it",
    dateLocale: "en-GB",
  },
};

function renderInvoiceEmailHtml(params: {
  lang: EmailLang;
  /** A credit note asks for no payment: no due date row, "document" instead of "invoice". */
  creditNote: boolean;
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
  credit?: BrandCredit | null;
}): string {
  const portalUrl = portalUrlOf(params.publicLink);
  const accent = params.accent && /^#[0-9a-fA-F]{6}$/.test(params.accent) ? params.accent : "#111827";
  const paragraphs = (text: string) => escapeHtml(text).replace(/\r?\n/g, "<br>");
  const l = EMAIL_LABELS[params.lang];
  const dueDateFormatted = params.dueDate
    ? params.dueDate.toLocaleDateString(l.dateLocale, { year: "numeric", month: "2-digit", day: "2-digit" })
    : l.notStated;

  return `<!doctype html>
<html lang="${params.lang}">
  <body style="font-family: -apple-system, Helvetica, Arial, sans-serif; background:#f4f5f7; margin:0; padding:24px;">
    <table role="presentation" width="100%" style="max-width:560px; margin:0 auto; background:#ffffff; border-radius:8px; overflow:hidden;">
      <tr>
        <td style="padding:32px;">
          <h1 style="font-size:20px; margin:0 0 16px; color:#111;">${escapeHtml(params.heading)}</h1>
          <p style="font-size:14px; color:#333; margin:0 0 24px; line-height:1.5;">${paragraphs(params.intro)}</p>
          <table role="presentation" width="100%" style="font-size:14px; color:#333; margin-bottom:24px; border-collapse:collapse;">
            <tr>
              <td style="padding:6px 0; color:#666;">${params.creditNote ? l.documentNumber : l.invoiceNumber}</td>
              <td style="padding:6px 0; text-align:right;"><strong>${escapeHtml(params.invoiceNumber)}</strong></td>
            </tr>
            <tr>
              <td style="padding:6px 0; color:#666;">${l.amount}</td>
              <td style="padding:6px 0; text-align:right;"><strong>${escapeHtml(params.amount)}</strong></td>
            </tr>
            ${
              params.creditNote
                ? ""
                : `<tr>
              <td style="padding:6px 0; color:#666;">${l.dueDate}</td>
              <td style="padding:6px 0; text-align:right;">${escapeHtml(dueDateFormatted)}</td>
            </tr>`
            }
          </table>
          <p style="text-align:center; margin:0 0 8px;">
            <a href="${portalUrl}" style="display:inline-block; background:${accent}; color:#ffffff; text-decoration:none; padding:12px 24px; border-radius:6px; font-size:14px;">${params.creditNote ? l.viewDocument : l.viewInvoice}</a>
          </p>
          ${
            params.clientPortalLink
              ? `<p style="text-align:center; font-size:13px; margin:12px 0 0;"><a href="${clientPortalUrlOf(params.clientPortalLink)}" style="color:${accent};">${l.allDocuments}</a></p>`
              : ""
          }
          ${
            params.attachmentNames?.length
              ? `<p style="font-size:13px; color:#555; margin:20px 0 0;">${l.attachments}: ${params.attachmentNames.map(escapeHtml).join(", ")}</p>`
              : ""
          }
          ${params.signature ? `<p style="font-size:14px; color:#333; margin:20px 0 0; line-height:1.5;">${paragraphs(params.signature)}</p>` : ""}
          <p style="font-size:12px; color:#999; text-align:center; margin-top:24px; word-break:break-all;">
            ${escapeHtml(portalUrl)}
          </p>
          <p style="font-size:11px; color:#aaa; text-align:center; margin-top:8px;">
            ${l.unexpected} <a href="${portalUrl}?report=1" style="color:#888;">${l.report}</a>.
          </p>
        </td>
      </tr>
    </table>
    ${
      params.credit
        ? `<p style="font-size:11px; color:#9ca3af; text-align:center; margin:16px 0 0;"><a href="${escapeHtml(params.credit.url)}" style="color:#9ca3af; text-decoration:none;">${escapeHtml(params.credit.label)}</a></p>`
        : ""
    }
  </body>
</html>`;
}


function placeholderValues(params: SendInvoiceEmailParams): Record<string, string> {
  return {
    ...params.custom?.vars,
    number: params.invoiceNumber,
    amount: params.amount,
    due_date: params.dueDate
      ? params.dueDate.toLocaleDateString(EMAIL_LABELS[emailLangOf(params.language)].dateLocale, { year: "numeric", month: "2-digit", day: "2-digit" })
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
